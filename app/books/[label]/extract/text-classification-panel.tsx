"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PageTextClassification } from "@/lib/books";
import { TextTypeBadge } from "./text-type-badge";
import { usePipelineBusy } from "../use-pipeline-refresh";
import { NodeHeader, type VersionApi } from "../node-header";

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
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [isDirty, setIsDirty] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const pipelineBusy = usePipelineBusy(pageId, "text-classification");
  const [rerunError, setRerunError] = useState<string | null>(null);
  const currentVersionRef = useRef(initialVersion);

  const apiBase = `/api/books/${label}/pages/${pageId}/text-classification`;

  const versionApi: VersionApi = useMemo(() => ({
    loadVersion: async (v: number) => {
      const res = await fetch(`${apiBase}?version=${v}`);
      if (!res.ok) throw new Error("Failed to load version");
      return res.json();
    },
    saveVersion: async (v: number) => {
      const res = await fetch(apiBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
  }), [apiBase, data]);

  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    try {
      const res = await fetch(apiBase, { method: "POST" });
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
            const { version: newVersion, versions: newVersions, data: newData } = job.result as {
              version: number; versions: number[]; data: PageTextClassification;
            };
            setData(newData);
            currentVersionRef.current = newVersion;
            setVersions(newVersions ?? [newVersion]);
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
      const json = await versionApi.loadVersion(currentVersionRef.current);
      const resp = json as { data: PageTextClassification };
      setData(resp.data);
    } catch {
      // ignore
    }
    setIsDirty(false);
  }

  return (
    <div>
      <NodeHeader
        title="Text"
        color="indigo"
        initialVersion={initialVersion}
        initialVersions={versions}
        versionApi={versionApi}
        onVersionLoaded={(v, raw) => {
          const resp = raw as { data: PageTextClassification };
          setData(resp.data);
          currentVersionRef.current = v;
        }}
        onVersionSaved={(newVersion, newVersions, raw) => {
          const resp = raw as { data: PageTextClassification };
          setData(resp.data);
          currentVersionRef.current = newVersion;
          setVersions(newVersions);
          setIsDirty(false);
        }}
        rerunLoading={rerunning || pipelineBusy}
        rerunDisabled={isDirty}
        onRerun={handleRerun}
        rerunTitle={data ? "Rerun classification" : "Run classification"}
        isDirty={isDirty}
        onDirtyDiscard={discardEdits}
        error={rerunError}
      />
      {!data ? (
        <p className="p-4 text-sm italic text-muted">
          No text classification for this page.
        </p>
      ) : (
        <div className="space-y-3 p-4">
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
      )}
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
