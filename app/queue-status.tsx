"use client";

import { useEffect, useRef, useState } from "react";

interface JobInfo {
  id: string;
  type: string;
  label: string;
  status: string;
  progress?: string;
  params?: Record<string, unknown>;
}

interface QueueStats {
  queued: number;
  running: number;
}

export default function QueueStatus() {
  const [stats, setStats] = useState<QueueStats>({ queued: 0, running: 0 });
  const [jobs, setJobs] = useState<Map<string, JobInfo>>(new Map());
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/queue");

    es.addEventListener("stats", (e) => {
      try {
        setStats(JSON.parse(e.data));
      } catch {
        // skip malformed
      }
    });

    es.addEventListener("job", (e) => {
      try {
        const job = JSON.parse(e.data) as JobInfo;
        setJobs((prev) => {
          const next = new Map(prev);
          if (job.status === "completed" || job.status === "failed") {
            next.delete(job.id);
          } else {
            next.set(job.id, job);
          }
          return next;
        });
      } catch {
        // skip malformed
      }
    });

    es.onerror = () => {
      // silently reconnect (EventSource auto-reconnects)
    };

    return () => es.close();
  }, []);

  const active = stats.running + stats.queued;

  // Reset hover when transitioning from idle to active
  const wasActive = useRef(false);
  useEffect(() => {
    if (active > 0 && !wasActive.current) {
      setHovered(false);
    }
    wasActive.current = active > 0;
  }, [active]);

  if (active === 0) return null;

  const sortedJobs = [...jobs.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "running" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return (
    <div
      ref={containerRef}
      className="fixed top-4 right-4 z-50"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex justify-end">
        <span className="inline-flex cursor-default items-center gap-1.5 rounded-full bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-300 shadow-lg shadow-black/30">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          {stats.running > 0 && <span>{stats.running} running</span>}
          {stats.running > 0 && stats.queued > 0 && <span>&middot;</span>}
          {stats.queued > 0 && <span>{stats.queued} queued</span>}
        </span>
      </div>

      {hovered && sortedJobs.length > 0 && (
        <div className="mt-2 w-72 max-h-80 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
          <div className="px-3 py-2 text-xs font-semibold text-slate-400 border-b border-slate-700">
            Active Jobs
          </div>
          {sortedJobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5 last:border-b-0"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  job.status === "running" ? "bg-green-500" : "bg-yellow-500"
                }`}
              />
              <span className="truncate text-xs font-medium text-slate-200">
                {job.label}
              </span>
              <span className="shrink-0 rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-500">
                {formatJobType(job)}
              </span>
              {job.progress && (
                <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                  {job.progress}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatJobType(job: JobInfo): string {
  if (job.type === "page-pipeline" && job.params?.pageId) {
    return String(job.params.pageId);
  }
  return job.type.replace(/-/g, " ");
}
