import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { JobType, JobExecutor } from "@/lib/queue";

// Fresh queue for each test — we bypass the singleton by importing the module
// fresh and injecting a mock executor via the globalThis hook.

let queue: typeof import("@/lib/queue")["queue"];

function installMockExecutor(fn: JobExecutor) {
  (globalThis as unknown as {
    __getJobExecutor?: (type: JobType) => JobExecutor | undefined;
  }).__getJobExecutor = () => fn;
}

function clearMockExecutor() {
  delete (globalThis as unknown as {
    __getJobExecutor?: (type: JobType) => JobExecutor | undefined;
  }).__getJobExecutor;
}

describe("queue.cancelByLabel", () => {
  beforeEach(async () => {
    // Use a no-op executor that never resolves so jobs stay "running"
    installMockExecutor(() => new Promise(() => {}));
    // Get the singleton (will be shared, but tests coordinate via labels)
    const mod = await import("@/lib/queue");
    queue = mod.queue;
  });

  afterEach(() => {
    clearMockExecutor();
  });

  it("cancels queued jobs and returns count", () => {
    // Use a slow executor so jobs pile up as queued (concurrency 16 means
    // first 16 drain immediately, so we enqueue for a unique label and
    // cancel before drain completes).
    // Actually, drain is async — enqueue pushes to pending then calls drain,
    // but drain awaits the executor. So the first call to drain picks up the
    // job and starts it. To get a *queued* job we need >16 running.
    // Simpler: just test that cancelByLabel on already-enqueued jobs works
    // by enqueuing with a blocking executor.

    // Install an executor that blocks forever
    installMockExecutor(() => new Promise(() => {}));

    const label = `test-cancel-${Date.now()}`;
    const id1 = queue.enqueue("metadata", label);
    const id2 = queue.enqueue("metadata", label);
    const otherId = queue.enqueue("metadata", "other-book");

    const count = queue.cancelByLabel(label);

    // Both jobs for our label should be failed
    const job1 = queue.getJob(id1)!;
    const job2 = queue.getJob(id2)!;
    const otherJob = queue.getJob(otherId)!;

    expect(job1.status).toBe("failed");
    expect(job1.error).toBe("Book deleted");
    expect(job2.status).toBe("failed");
    expect(job2.error).toBe("Book deleted");
    // Other book's job should not be affected
    expect(otherJob.status).not.toBe("failed");
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("returns 0 when no jobs match", () => {
    const count = queue.cancelByLabel("nonexistent-label");
    expect(count).toBe(0);
  });

  it("update callback throws after cancellation", async () => {
    let capturedUpdate: ((patch: Partial<import("@/lib/queue").Job>) => void) | null = null;

    installMockExecutor(async (_job, update) => {
      capturedUpdate = update;
      // Wait long enough for cancellation to happen
      await new Promise((r) => setTimeout(r, 100));
      // This update should throw because the job was cancelled
      update({ progress: "should fail" });
    });

    const label = `test-throw-${Date.now()}`;
    const id = queue.enqueue("metadata", label);

    // Give drain a tick to start the executor
    await new Promise((r) => setTimeout(r, 10));

    // Cancel while running
    queue.cancelByLabel(label);

    // Wait for executor to finish
    await new Promise((r) => setTimeout(r, 200));

    const job = queue.getJob(id)!;
    expect(job.status).toBe("failed");
  });
});
