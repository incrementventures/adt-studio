"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PageTextClassification } from "@/lib/books";
import { TextTypeBadge } from "./text-type-badge";
import { usePipelineBusy } from "../use-pipeline-refresh";

interface TextClassificationPanelProps {
  label: string;
  pageId: string;
  initialData: PageTextClassification | null;
  initialVersion: number;
  availableVersions: number[];
  textTypes: string[];
  groupTypes: string[];
}

export function TextClassificationPanel({
  label,
  pageId,
  initialData,
  initialVersion,
  availableVersions: initialAvailableVersions,
  textTypes,
  groupTypes,
}: TextClassificationPanelProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [version, setVersion] = useState(initialVersion);
  const [latestVersion, setLatestVersion] = useState(initialVersion);
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const pipelineBusy = usePipelineBusy(pageId, "text-classification");
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);

  // Sync from server props when router.refresh() delivers new data.
  // Only reacts to prop changes — not isDirty changes — to avoid
  // clobbering freshly-saved state with stale server props.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    if (!isDirtyRef.current) {
      setData(initialData);
      setVersion(initialVersion);
      setLatestVersion(initialVersion);
      setVersions(initialAvailableVersions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, initialVersion, initialAvailableVersions]);

  const versionLabel = `v${version}`;

  // Close version dropdown on outside click / escape
  useEffect(() => {
    if (!versionDropdownOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVersionDropdownOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (
        versionDropdownRef.current &&
        !versionDropdownRef.current.contains(e.target as Node)
      ) {
        setVersionDropdownOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [versionDropdownOpen]);

  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/text-classification`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const { jobId } = await res.json();
      if (!jobId) throw new Error("No job ID returned");

      const es = new EventSource(`/api/queue?jobId=${jobId}`);
      es.addEventListener("job", (e) => {
        try {
          const job = JSON.parse(e.data);
          if (job.status === "completed") {
            const { version: newVersion, ...rest } = job.result as { version: number } & PageTextClassification;
            setData(rest as PageTextClassification);
            setVersion(newVersion);
            setLatestVersion(newVersion);
            setVersions([1]);
            setIsDirty(false);
            setRerunning(false);
            router.refresh();
            es.close();
          } else if (job.status === "failed") {
            setRerunError(job.error ?? "Classification failed");
            setRerunning(false);
            es.close();
          }
        } catch { /* skip */ }
      });
      es.onerror = () => {
        setRerunError("Connection to job queue lost");
        setRerunning(false);
        es.close();
      };
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : "Unknown error");
      setRerunning(false);
    }
  }

  const rerunButton = (
    <button
      type="button"
      onClick={handleRerun}
      disabled={rerunning || pipelineBusy || isDirty}
      className="cursor-pointer rounded p-1 text-white/80 hover:text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
      title={data ? "Rerun classification" : "Run classification"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-4 w-4 ${rerunning || pipelineBusy ? "animate-spin" : ""}`}
      >
        <path
          fillRule="evenodd"
          d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.434l.311.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.311H11.768a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.53a.75.75 0 00-1.5 0v2.434l-.311-.312A7 7 0 002.629 8.79a.75.75 0 001.449.39z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );

  if (!data) {
    return (
      <div>
        <div className="flex items-center gap-2 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
          <span>Text</span>
          {rerunError && (
            <span className="text-xs font-normal text-red-200">{rerunError}</span>
          )}
          <div className="ml-auto">{rerunButton}</div>
        </div>
        <p className="p-4 text-sm italic text-muted">
          No text classification for this page.
        </p>
      </div>
    );
  }

  async function loadVersion(v: number) {
    setVersionDropdownOpen(false);
    if (v === version) return;
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/text-classification`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: v }),
        }
      );
      if (!res.ok) return;
      const json = await res.json();
      setData(json.data as PageTextClassification);
      setVersion(v);
      setIsDirty(v !== latestVersion);
    } catch {
      // ignore
    }
  }

  function applyEdit(mutator: (draft: PageTextClassification) => void) {
    setData((prev) => {
      if (!prev) return prev;
      const next: PageTextClassification = JSON.parse(JSON.stringify(prev));
      mutator(next);
      return next;
    });
    setIsDirty(true);
  }

  async function discardEdits() {
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/text-classification`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: latestVersion }),
        }
      );
      if (!res.ok) return;
      const json = await res.json();
      setData(json.data as PageTextClassification);
      setVersion(latestVersion);
    } catch {
      // ignore
    }
    setIsDirty(false);
  }

  async function saveChanges() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/text-classification`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data, baseVersion: version }),
        }
      );
      if (!res.ok) return;
      const json = await res.json();
      const { version: newVersion, ...rest } = json;
      const saved = rest as PageTextClassification;
      setVersion(newVersion);
      setLatestVersion(newVersion);
      setData(saved);
      setIsDirty(false);
      setVersions((prev) =>
        prev.includes(newVersion)
          ? prev
          : [...prev, newVersion].sort((a, b) => a - b)
      );
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
        <span>Text</span>
        {rerunError && (
          <span className="text-xs font-normal text-red-200">{rerunError}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {isDirty && (
            <>
              <button
                type="button"
                onClick={discardEdits}
                disabled={saving}
                className="cursor-pointer rounded bg-indigo-500 px-2 py-0.5 text-xs font-medium hover:bg-indigo-400 disabled:opacity-50 transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={saveChanges}
                disabled={saving}
                className="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-70 transition-colors"
              >
                {saving && (
                  <svg
                    className="h-3 w-3 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                Save
              </button>
            </>
          )}
          <div ref={versionDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setVersionDropdownOpen(!versionDropdownOpen)}
              className="cursor-pointer rounded bg-indigo-500 px-1.5 py-0.5 text-xs font-medium hover:bg-indigo-400 transition-colors"
            >
              {versionLabel} ▾
            </button>
            {versionDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-36 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
                {versions.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => loadVersion(v)}
                    className={`flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface ${v === version ? "font-semibold bg-surface" : ""}`}
                  >
                    {`v${v}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          {rerunButton}
        </div>
      </div>
      <div key={`${version}-${isDirty}`} className="space-y-3 p-4">
        {data.groups.length === 0 && (
          <p className="text-sm italic text-muted">
            No text extracted from this page.
          </p>
        )}
        {data.groups.map((group, gi) => (
          <div key={gi} className="rounded-lg border border-border p-3">
            <GroupTypeLabel
              currentType={group.group_type}
              groupTypes={groupTypes}
              onSelect={(newType) => {
                applyEdit((d) => {
                  d.groups[gi].group_type = newType;
                });
              }}
            />
            <div className="space-y-1.5">
              {group.texts.map((entry, ti) => (
                <div
                  key={ti}
                  className={`group/entry flex items-start gap-1.5${entry.is_pruned ? " opacity-40 line-through" : ""}`}
                >
                  <button
                    type="button"
                    title={
                      entry.is_pruned
                        ? "Pruned — click to unprune"
                        : "Click to prune"
                    }
                    onClick={() =>
                      applyEdit((d) => {
                        d.groups[gi].texts[ti].is_pruned = !entry.is_pruned;
                      })
                    }
                    className={`mt-0.5 shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-foreground transition-colors${entry.is_pruned ? "" : " opacity-0 group-hover/entry:opacity-100"}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.965 4.904l9.131 9.131a6.5 6.5 0 00-9.131-9.131zm8.07 10.192L4.904 5.965a6.5 6.5 0 009.131 9.131zM4.343 4.343a8 8 0 1111.314 11.314A8 8 0 014.343 4.343z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <EditableText
                    text={entry.text}
                    onSave={(newText) => {
                      applyEdit((d) => {
                        d.groups[gi].texts[ti].text = newText;
                      });
                    }}
                  />
                  <div className="shrink-0">
                    <TextTypeBadge
                      label={label}
                      pageId={pageId}
                      groupIndex={gi}
                      textIndex={ti}
                      currentType={entry.text_type}
                      textTypes={textTypes}
                      onTypeChange={(newType) => {
                        applyEdit((d) => {
                          d.groups[gi].texts[ti].text_type = newType;
                        });
                        return Promise.resolve(true);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── GroupTypeLabel ──────────────────────────────────────────────── */

function GroupTypeLabel({
  currentType,
  groupTypes,
  onSelect,
}: {
  currentType: string;
  groupTypes: string[];
  onSelect: (newType: string) => void;
}) {
  const [type, setType] = useState(currentType);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setType(currentType);
  }, [currentType]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, close]);

  function handleSelect(newType: string) {
    if (newType === type) {
      close();
      return;
    }
    setType(newType);
    close();
    onSelect(newType);
  }

  return (
    <div ref={containerRef} className="relative mb-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="cursor-pointer text-xs font-medium uppercase tracking-wider text-faint hover:text-foreground"
      >
        {type}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {groupTypes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleSelect(t)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface ${t === type ? "font-semibold" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── EditableText ───────────────────────────────────────────────── */

function EditableText({
  text,
  onSave,
}: {
  text: string;
  onSave: (newText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync if parent data updates
  useEffect(() => {
    if (!editing) setValue(text);
  }, [text, editing]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  function save() {
    setEditing(false);
    if (value === text) return;
    onSave(value);
  }

  function cancel() {
    setValue(text);
    setEditing(false);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        className="flex-1 resize-none rounded border border-border bg-surface p-1 font-mono text-xs whitespace-pre-wrap focus:outline-none focus:ring-1 focus:ring-indigo-500"
        rows={Math.max(1, value.split("\n").length)}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="min-w-0 flex-1 cursor-pointer rounded px-1 py-0.5 font-mono text-xs whitespace-pre-wrap hover:bg-surface"
    >
      {value}
    </span>
  );
}
