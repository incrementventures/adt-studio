"use client";

import { useEffect, useState } from "react";

interface QueueStats {
  queued: number;
  running: number;
}

export default function QueueStatus() {
  const [stats, setStats] = useState<QueueStats>({ queued: 0, running: 0 });

  useEffect(() => {
    const es = new EventSource("/api/queue");

    es.addEventListener("stats", (e) => {
      try {
        setStats(JSON.parse(e.data));
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

  if (active === 0) {
    return (
      <span className="rounded-full bg-slate-700/50 px-3 py-1 text-xs text-slate-400">
        Pipeline Idle
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/50 px-3 py-1 text-xs text-slate-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      {stats.running > 0 && <span>{stats.running} running</span>}
      {stats.running > 0 && stats.queued > 0 && <span>&middot;</span>}
      {stats.queued > 0 && <span>{stats.queued} queued</span>}
    </span>
  );
}
