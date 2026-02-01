"use client";

import { Fragment, useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { LlmLogEntry } from "@/lib/books";
import type { LlmLogImagePlaceholder } from "@/lib/pipeline/llm-log";

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function JsonHighlighted({ text }: { text: string }) {
  let json: string;
  try {
    json = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return <>{text}</>;
  }

  const tokens = json.split(
    /("(?:\\.|[^"\\])*")\s*(:?)|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  );

  return (
    <>
      {tokens.map((tok, i) => {
        if (tok === undefined || tok === "") return null;
        if (tok === ":") return null; // consumed by lookahead below
        // string followed by colon = key
        if (tok.startsWith('"') && tokens[i + 1] === ":") {
          return (
            <span key={i} className="text-sky-400">
              {tok}
            </span>
          );
        }
        // string value
        if (tok.startsWith('"')) {
          return (
            <span key={i} className="text-amber-300">
              {tok}
            </span>
          );
        }
        // boolean / null
        if (tok === "true" || tok === "false" || tok === "null") {
          return (
            <span key={i} className="text-violet-400">
              {tok}
            </span>
          );
        }
        // number
        if (/^-?\d/.test(tok)) {
          return (
            <span key={i} className="text-emerald-400">
              {tok}
            </span>
          );
        }
        // punctuation / whitespace
        return (
          <span key={i} className="text-slate-500">
            {tok}
          </span>
        );
      })}
    </>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LlmLogViewer({
  label,
  entries: initialEntries,
}: {
  label: string;
  entries: LlmLogEntry[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [taskFilter, setTaskFilter] = useState("");
  const [pageFilter, setPageFilter] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Track the latest timestamp we've seen (entries are newest-first)
  const latestTimestampRef = useRef(initialEntries[0]?.timestamp ?? "");

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/books/${encodeURIComponent(label)}/log?after=${encodeURIComponent(latestTimestampRef.current)}`,
        );
        if (!res.ok) return;
        const data = await res.json() as { entries: LlmLogEntry[] };
        if (data.entries.length > 0) {
          // data.entries is newest-first
          latestTimestampRef.current = data.entries[0].timestamp;
          setEntries((prev) => [...data.entries, ...prev]);
          setExpandedIndex((prev) => prev !== null ? prev + data.entries.length : null);
        }
      } catch {
        // Polling failure is non-critical
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [label]);

  const taskTypes = useMemo(
    () => [...new Set(entries.map((e) => e.taskType))].sort(),
    [entries],
  );
  const pageIds = useMemo(
    () => [...new Set(entries.map((e) => e.pageId).filter(Boolean))].sort() as string[],
    [entries],
  );

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (taskFilter && e.taskType !== taskFilter) return false;
        if (pageFilter && e.pageId !== pageFilter) return false;
        return true;
      }),
    [entries, taskFilter, pageFilter],
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex justify-between">
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-foreground"
        >
          <option value="">All task types</option>
          {taskTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={pageFilter}
          onChange={(e) => setPageFilter(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-foreground"
        >
          <option value="">All pages</option>
          {pageIds.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-surface text-faint">
            <tr>
              <th className="px-2 py-1.5">Time</th>
              <th className="px-2 py-1.5">Task</th>
              <th className="px-2 py-1.5">Page</th>
              <th className="px-2 py-1.5">Prompt</th>
              <th className="px-2 py-1.5">Model</th>
              <th className="px-2 py-1.5 text-right">Tokens</th>
              <th className="px-2 py-1.5 text-center">Cache</th>
              <th className="px-2 py-1.5 text-right">Duration</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((entry, i) => {
              const errCount = entry.validationErrors?.length ?? 0;
              const isExpanded = expandedIndex === i;
              return (
                <Fragment key={i}>
                  <tr
                    onClick={() =>
                      setExpandedIndex(isExpanded ? null : i)
                    }
                    className="cursor-pointer text-foreground hover:bg-surface"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                      {formatTime(entry.timestamp)}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">
                        {entry.taskType}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {entry.pageId ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">{entry.promptName}</td>
                    <td className="px-2 py-1.5 text-faint">{entry.modelId}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-faint">
                      {entry.usage
                        ? `${formatTokens(entry.usage.inputTokens + entry.usage.outputTokens)}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          entry.cacheHit
                            ? "bg-green-400"
                            : "bg-slate-600"
                        }`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">
                      {formatDuration(entry.durationMs)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {entry.attempt > 0 && (
                        <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                          {entry.attempt}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td
                        colSpan={9}
                        className="border-t border-border bg-surface px-4 py-3"
                      >
                        <ExpandedDetail label={label} entry={entry} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImagePart({
  label,
  pageId,
  part,
}: {
  label: string;
  pageId?: string;
  part: LlmLogImagePlaceholder;
}) {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);

  const caption = `${part.width}\u00d7${part.height}, ${formatBytes(part.byteLength)}`;

  if (!part.hash || failed) {
    return (
      <div className="my-1 inline-flex items-center gap-1.5 rounded border border-border bg-slate-800 px-2 py-1 text-[10px] text-slate-400">
        [Image{failed ? " not found" : ""}: {caption}]
      </div>
    );
  }

  const pageParam = pageId ? `?pageId=${encodeURIComponent(pageId)}` : "";
  const src = `/api/books/${encodeURIComponent(label)}/images/by-hash/${part.hash}${pageParam}`;

  return (
    <div className="my-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Image ${part.hash}`}
        onError={onError}
        className="max-h-64 rounded border border-border"
      />
      <span className="mt-0.5 block text-[10px] text-faint">{caption}</span>
    </div>
  );
}

function ExpandedDetail({ label, entry }: { label: string; entry: LlmLogEntry }) {
  return (
    <div className="space-y-3 text-xs">
      {entry.system && (
        <div>
          <h4 className="mb-1 font-semibold text-faint">System prompt</h4>
          <pre className="whitespace-pre-wrap rounded border border-border bg-background p-2 text-foreground">
            {entry.system}
          </pre>
        </div>
      )}


      {entry.messages.length > 0 && (
        <div>
          <h4 className="mb-1 font-semibold text-faint">Messages</h4>
          <div className="space-y-2">
            {entry.messages.map((msg, i) => (
              <div key={i}>
                <span className="inline-block rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                  {msg.role}
                </span>
                {msg.content.map((part, j) =>
                  part.type === "image" ? (
                    <ImagePart
                      key={j}
                      label={label}
                      pageId={entry.pageId}
                      part={part as LlmLogImagePlaceholder}
                    />
                  ) : (
                    <pre
                      key={j}
                      className={`mt-1 whitespace-pre-wrap rounded border border-border p-2 ${
                        msg.role === "assistant"
                          ? "bg-slate-900 text-slate-300"
                          : "bg-background text-foreground"
                      }`}
                    >
                      {msg.role === "assistant" ? <JsonHighlighted text={part.text} /> : part.text}
                    </pre>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
