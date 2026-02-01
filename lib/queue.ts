import { extractMetadata } from "@/lib/pipeline/metadata/metadata";
import { getBookMetadata } from "@/lib/books";

// --- Types ---

export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobType = "metadata"; // extend later

export interface Job {
  id: string;
  type: JobType;
  label: string;
  status: JobStatus;
  progress?: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export type JobExecutor = (
  job: Job,
  update: (patch: Partial<Job>) => void
) => Promise<void>;

// --- Queue ---

class JobQueue {
  jobs = new Map<string, Job>();
  private pending: string[] = [];
  private running = 0;
  private executors = new Map<JobType, JobExecutor>();
  private listeners = new Set<(job: Job) => void>();
  private concurrency = 1;
  private nextId = 1;

  constructor() {
    this.registerExecutor("metadata", metadataExecutor);
  }

  registerExecutor(type: JobType, executor: JobExecutor) {
    this.executors.set(type, executor);
  }

  enqueue(type: JobType, label: string): string {
    const id = `job_${this.nextId++}`;
    const job: Job = {
      id,
      type,
      label,
      status: "queued",
      createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.pending.push(id);
    this.notify(job);
    this.drain();
    return id;
  }

  private async drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const jobId = this.pending.shift()!;
      const job = this.jobs.get(jobId);
      if (!job) continue;

      const executor = this.executors.get(job.type);
      if (!executor) {
        this.updateJob(job, {
          status: "failed",
          error: `No executor for type "${job.type}"`,
          completedAt: Date.now(),
        });
        continue;
      }

      this.running++;
      this.updateJob(job, { status: "running", startedAt: Date.now() });

      try {
        await executor(job, (patch) => this.updateJob(job, patch));
        if (job.status === "running") {
          this.updateJob(job, { status: "completed", completedAt: Date.now() });
        }
      } catch (err) {
        this.updateJob(job, {
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
          completedAt: Date.now(),
        });
      } finally {
        this.running--;
        this.prune();
        this.drain();
      }
    }
  }

  private updateJob(job: Job, patch: Partial<Job>) {
    Object.assign(job, patch);
    this.notify(job);
  }

  subscribe(fn: (job: Job) => void) {
    this.listeners.add(fn);
  }

  unsubscribe(fn: (job: Job) => void) {
    this.listeners.delete(fn);
  }

  private notify(job: Job) {
    for (const fn of this.listeners) {
      try {
        fn(job);
      } catch {
        // listener errors should not break the queue
      }
    }
  }

  getStats(): { queued: number; running: number } {
    let queued = 0;
    let running = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "queued") queued++;
      if (job.status === "running") running++;
    }
    return { queued, running };
  }

  getActiveJobs(): Job[] {
    return [...this.jobs.values()].filter(
      (j) => j.status === "queued" || j.status === "running"
    );
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  private prune() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        job.completedAt &&
        job.completedAt < oneHourAgo
      ) {
        this.jobs.delete(id);
      }
    }
  }
}

// --- Metadata Executor ---

const metadataExecutor: JobExecutor = async (job, update) => {
  return new Promise<void>((resolve, reject) => {
    const obs = extractMetadata(job.label);
    obs.subscribe({
      next(progress) {
        update({ progress: progress.phase });
      },
      error(err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
      complete() {
        const metadata = getBookMetadata(job.label);
        update({ result: metadata, status: "completed", completedAt: Date.now() });
        resolve();
      },
    });
  });
};

// --- Singleton ---

const globalForQueue = globalThis as unknown as { __jobQueue?: JobQueue };
export const queue = globalForQueue.__jobQueue ?? new JobQueue();
globalForQueue.__jobQueue = queue;
