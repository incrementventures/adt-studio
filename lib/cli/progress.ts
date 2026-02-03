/**
 * Dynamic CLI Progress Display
 *
 * Shows parallel task progress with animated spinners and progress bars.
 */

import type { Observable } from "rxjs";

// ANSI escape codes
const ESC = "\x1b";
const CLEAR_LINE = `${ESC}[2K`;
const MOVE_UP = (n: number) => `${ESC}[${n}A`;
const MOVE_DOWN = (n: number) => `${ESC}[${n}B`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const RED = `${ESC}[31m`;
const CYAN = `${ESC}[36m`;
const BOLD = `${ESC}[1m`;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 30;

export interface ProgressOptions {
  label: string;
  unit?: string;
  barWidth?: number;
  stream?: NodeJS.WriteStream;
}

// ============================================================================
// Legacy Observable-based progress (for backwards compatibility)
// ============================================================================

export function runWithProgress<T>(
  source: Observable<T>,
  mapper: (value: T) => { current: number; total: number },
  options: ProgressOptions
): Promise<void> {
  const {
    label,
    unit = "pages",
    barWidth = 20,
    stream = process.stderr,
  } = options;

  let current = 0;
  let total = 0;
  let frame = 0;

  function render(spinner: string) {
    const filled = total > 0 ? Math.round((current / total) * barWidth) : 0;
    const empty = barWidth - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    const line = `${spinner} ${label}  ${bar}  ${current}/${total} ${unit}`;
    stream.write(`\r${line}`);
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      render(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
      frame++;
    }, 80);

    source.subscribe({
      next(value) {
        const progress = mapper(value);
        current = progress.current;
        total = progress.total;
      },
      error(err) {
        clearInterval(timer);
        stream.write("\n");
        stream.write(`✗ ${label}  ${String(err)}\n`);
        reject(err);
      },
      complete() {
        clearInterval(timer);
        const filled = "█".repeat(barWidth);
        stream.write(
          `\r✔ ${label}  ${filled}  ${current}/${total} ${unit}\n`
        );
        resolve();
      },
    });
  });
}

// ============================================================================
// Parallel Progress Display
// ============================================================================

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskState {
  id: string;
  label: string;
  status: TaskStatus;
  step?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

export interface ParallelProgressOptions {
  concurrency?: number;
  stream?: NodeJS.WriteStream;
}

/**
 * Dynamic progress display for parallel task execution.
 */
export class ParallelProgress {
  private tasks = new Map<string, TaskState>();
  private completedCount = 0;
  private failedCount = 0;
  private totalCount = 0;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private renderedLines = 0;
  private stream: NodeJS.WriteStream;
  private startTime = Date.now();
  private maxVisibleTasks = 16;

  constructor(options: ParallelProgressOptions = {}) {
    this.stream = options.stream ?? process.stderr;
  }

  /**
   * Start the progress display.
   */
  start(totalCount: number): void {
    this.totalCount = totalCount;
    this.startTime = Date.now();
    this.stream.write(HIDE_CURSOR);
    this.timer = setInterval(() => {
      this.frame++;
      this.render();
    }, 80);
    this.render();
  }

  /**
   * Stop the progress display.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearDisplay();
    this.stream.write(SHOW_CURSOR);
    this.renderSummary();
  }

  /**
   * Update a task's state.
   */
  updateTask(id: string, update: Partial<TaskState>): void {
    const existing = this.tasks.get(id) ?? {
      id,
      label: id,
      status: "pending" as TaskStatus,
    };

    const newState = { ...existing, ...update };

    // Track completion/failure
    if (existing.status !== "completed" && newState.status === "completed") {
      this.completedCount++;
      newState.endTime = Date.now();
    }
    if (existing.status !== "failed" && newState.status === "failed") {
      this.failedCount++;
      newState.endTime = Date.now();
    }
    if (newState.status === "running" && !existing.startTime) {
      newState.startTime = Date.now();
    }

    this.tasks.set(id, newState);
  }

  /**
   * Get current statistics.
   */
  getStats(): { completed: number; failed: number; running: number; pending: number } {
    let running = 0;
    let pending = 0;
    for (const task of this.tasks.values()) {
      if (task.status === "running") running++;
      if (task.status === "pending") pending++;
    }
    return {
      completed: this.completedCount,
      failed: this.failedCount,
      running,
      pending: this.totalCount - this.tasks.size,
    };
  }

  private clearDisplay(): void {
    if (this.renderedLines > 0) {
      this.stream.write(MOVE_UP(this.renderedLines));
      for (let i = 0; i < this.renderedLines; i++) {
        this.stream.write(CLEAR_LINE + "\n");
      }
      this.stream.write(MOVE_UP(this.renderedLines));
    }
  }

  private render(): void {
    this.clearDisplay();

    const lines: string[] = [];
    const spinner = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    const elapsed = formatDuration(Date.now() - this.startTime);
    const stats = this.getStats();

    // Header with overall progress
    const progress = this.completedCount + this.failedCount;
    const pct = this.totalCount > 0 ? Math.round((progress / this.totalCount) * 100) : 0;
    const filled = Math.round((progress / Math.max(this.totalCount, 1)) * BAR_WIDTH);
    const bar = `${GREEN}${"█".repeat(filled)}${RESET}${DIM}${"░".repeat(BAR_WIDTH - filled)}${RESET}`;

    lines.push("");
    lines.push(
      `${BOLD}${CYAN}${spinner}${RESET} Processing pages  ${bar}  ${BOLD}${progress}${RESET}/${this.totalCount}  ${DIM}${pct}%${RESET}  ${DIM}${elapsed}${RESET}`
    );
    lines.push("");

    // Running tasks
    const running = [...this.tasks.values()]
      .filter((t) => t.status === "running")
      .slice(0, this.maxVisibleTasks);

    if (running.length > 0) {
      for (const task of running) {
        const taskSpinner = SPINNER_FRAMES[(this.frame + running.indexOf(task)) % SPINNER_FRAMES.length];
        const taskElapsed = task.startTime ? formatDuration(Date.now() - task.startTime) : "";
        const step = task.step ? `${DIM}${task.step}${RESET}` : "";
        lines.push(
          `  ${YELLOW}${taskSpinner}${RESET} ${task.label}  ${step}  ${DIM}${taskElapsed}${RESET}`
        );
      }
    }

    // Stats footer
    lines.push("");
    const runningCount = stats.running;
    const pendingCount = stats.pending;
    lines.push(
      `  ${DIM}Running: ${RESET}${runningCount}${DIM}  |  Pending: ${RESET}${pendingCount}${DIM}  |  Completed: ${RESET}${GREEN}${stats.completed}${RESET}${this.failedCount > 0 ? `${DIM}  |  Failed: ${RESET}${RED}${this.failedCount}${RESET}` : ""}${RESET}`
    );
    lines.push("");

    // Write all lines
    const output = lines.join("\n");
    this.stream.write(output);
    this.renderedLines = lines.length;
  }

  private renderSummary(): void {
    const elapsed = formatDuration(Date.now() - this.startTime);
    const success = this.completedCount;
    const failed = this.failedCount;

    this.stream.write("\n");
    if (failed === 0) {
      this.stream.write(
        `${GREEN}✔${RESET} ${BOLD}Completed${RESET} ${success} pages in ${elapsed}\n`
      );
    } else {
      this.stream.write(
        `${YELLOW}⚠${RESET} ${BOLD}Completed${RESET} ${success} pages, ${RED}${failed} failed${RESET} in ${elapsed}\n`
      );
    }
    this.stream.write("\n");
  }
}

// ============================================================================
// Parallel Executor
// ============================================================================

export interface ParallelExecutorOptions<T> {
  concurrency?: number;
  progress?: ParallelProgress;
  onTaskStart?: (item: T) => void;
  onTaskComplete?: (item: T) => void;
  onTaskError?: (item: T, error: Error) => void;
}

/**
 * Execute tasks in parallel with configurable concurrency.
 */
export async function runParallel<T>(
  items: T[],
  getId: (item: T) => string,
  execute: (item: T) => Promise<void>,
  options: ParallelExecutorOptions<T> = {}
): Promise<{ completed: number; failed: number; errors: Array<{ id: string; error: Error }> }> {
  const { concurrency = 16, progress, onTaskStart, onTaskComplete, onTaskError } = options;

  const queue = [...items];
  const errors: Array<{ id: string; error: Error }> = [];
  let completed = 0;
  let failed = 0;
  let running = 0;

  return new Promise((resolve) => {
    function tryStartNext(): void {
      while (running < concurrency && queue.length > 0) {
        const item = queue.shift()!;
        const id = getId(item);
        running++;

        progress?.updateTask(id, { label: id, status: "running" });
        onTaskStart?.(item);

        execute(item)
          .then(() => {
            completed++;
            progress?.updateTask(id, { status: "completed" });
            onTaskComplete?.(item);
          })
          .catch((err) => {
            failed++;
            const error = err instanceof Error ? err : new Error(String(err));
            errors.push({ id, error });
            progress?.updateTask(id, { status: "failed", error: error.message });
            onTaskError?.(item, error);
          })
          .finally(() => {
            running--;
            tryStartNext();

            // Check if all done
            if (running === 0 && queue.length === 0) {
              resolve({ completed, failed, errors });
            }
          });
      }
    }

    // Handle empty input
    if (items.length === 0) {
      resolve({ completed: 0, failed: 0, errors: [] });
      return;
    }

    tryStartNext();
  });
}

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
