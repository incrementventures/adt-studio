import { queue } from "@/lib/queue";
import type { Job } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filterJobId = searchParams.get("jobId");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Send initial state
      if (filterJobId) {
        const job = queue.getJob(filterJobId);
        if (job) send("job", job);
      } else {
        const stats = queue.getStats();
        send("stats", stats);
        for (const job of queue.getActiveJobs()) {
          send("job", job);
        }
      }

      const listener = (job: Job) => {
        if (filterJobId && job.id !== filterJobId) return;
        try {
          send("job", job);
          if (!filterJobId) {
            send("stats", queue.getStats());
          }
        } catch {
          // stream closed
          queue.unsubscribe(listener);
        }
      };

      queue.subscribe(listener);

      // Clean up on abort
      request.signal.addEventListener("abort", () => {
        queue.unsubscribe(listener);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
