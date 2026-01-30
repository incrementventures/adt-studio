import type { Observable } from "rxjs";

export interface ProgressOptions {
  label: string;
  unit?: string;
  barWidth?: number;
  stream?: NodeJS.WriteStream;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
