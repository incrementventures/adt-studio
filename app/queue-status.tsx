"use client";

import { useEffect, useRef, useState } from "react";

interface JobInfo {
  id: string;
  type: string;
  label: string;
  status: string;
  progress?: string;
  params?: Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
  /** Client-side timestamp when the finished event was received (for UI lingering) */
  finishedAt?: number;
}

const LINGER_MS = 5000;

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
        // For finished jobs, stamp finishedAt so we can linger them in the UI
        if (job.status === "completed" || job.status === "failed") {
          job.finishedAt = Date.now();
        }
        setJobs((prev) => {
          const next = new Map(prev);
          next.set(job.id, job);
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

  // Tick every second so elapsed times stay current
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
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

  // When the dropdown closes, reset linger timers so completed jobs
  // get a fresh LINGER_MS window before being pruned.
  useEffect(() => {
    if (!hovered) {
      const closeTime = Date.now();
      setJobs((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, job] of next) {
          if (job.finishedAt && job.finishedAt < closeTime) {
            next.set(id, { ...job, finishedAt: closeTime });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [hovered]);

  // Purge finished jobs that have lingered past LINGER_MS,
  // but only when the dropdown is closed.
  useEffect(() => {
    if (hovered) return;
    let anyExpired = false;
    for (const job of jobs.values()) {
      if (job.finishedAt && now - job.finishedAt >= LINGER_MS) {
        anyExpired = true;
        break;
      }
    }
    if (anyExpired) {
      setJobs((prev) => {
        const next = new Map(prev);
        for (const [id, job] of next) {
          if (job.finishedAt && now - job.finishedAt >= LINGER_MS) {
            next.delete(id);
          }
        }
        return next;
      });
    }
  }, [now, jobs, hovered]);

  if (active === 0 && jobs.size === 0) return null;

  const STATUS_ORDER: Record<string, number> = { running: 0, queued: 1, completed: 2, failed: 2 };
  const sortedJobs = [...jobs.values()].sort((a, b) => {
    const ao = STATUS_ORDER[a.status] ?? 1;
    const bo = STATUS_ORDER[b.status] ?? 1;
    if (ao !== bo) return ao - bo;
    return a.id.localeCompare(b.id);
  });

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex justify-end">
        <span className="inline-flex cursor-default items-center gap-1.5 rounded-full bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-300 shadow-lg shadow-black/30">
          {active > 0 ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
              {stats.running > 0 && <span>{stats.running} running</span>}
              {stats.running > 0 && stats.queued > 0 && <span>&middot;</span>}
              {stats.queued > 0 && <span>{stats.queued} queued</span>}
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span>{jobs.size} completed</span>
            </>
          )}
        </span>
      </div>

      {hovered && sortedJobs.length > 0 && (() => {
        const maxVisible = 18;
        const visible = sortedJobs.slice(0, maxVisible);
        const remaining = sortedJobs.length - visible.length;
        return (
          <div className="absolute right-0 top-full mt-2 w-96 rounded-lg border border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
            <div className="px-3 py-2 text-xs font-semibold text-slate-400 border-b border-slate-700">
              Active Jobs
            </div>
            {visible.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5 last:border-b-0"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    job.status === "completed" ? "bg-green-500" :
                    job.status === "failed" ? "bg-red-500" :
                    job.status === "running" ? "bg-blue-500 animate-pulse" : "bg-yellow-500"
                  }`}
                />
                <span className="truncate text-xs font-medium text-slate-200">
                  {job.label}
                </span>
                {job.progress && (
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {job.progress}
                  </span>
                )}
                <span className="ml-auto shrink-0 rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-500">
                  {formatJobType(job)}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-[11px] text-slate-600">
                  {formatElapsed(job, now)}
                </span>
              </div>
            ))}
            {remaining > 0 && (
              <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-700">
                {remaining} more queued
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function formatElapsed(job: JobInfo, now: number): string {
  const since = job.startedAt ?? 0;
  if (!since) return "";
  const end = job.completedAt ?? now;
  const secs = Math.max(0, Math.floor((end - since) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m${String(rem).padStart(2, "0")}s`;
}

function formatJobType(job: JobInfo): string {
  if (job.type === "page-pipeline" && job.params?.pageId) {
    return String(job.params.pageId);
  }
  return job.type.replace(/-/g, " ");
}
