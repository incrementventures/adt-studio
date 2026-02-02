"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PageTextClassification } from "@/lib/books";
import { TextTypeBadge } from "./text-type-badge";
import { EditableText } from "./editable-text";
import { TypeDropdown } from "./type-dropdown";
import { usePipelineBusy, usePanelJobBusy, usePanelJobError, useRerun } from "../use-pipeline-refresh";
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
  const [data, setData] = useState(initialData);
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [isDirty, setIsDirty] = useState(false);
  const pipelineBusy = usePipelineBusy(pageId, "text-classification");
  const panelJobBusy = usePanelJobBusy(pageId, "text-classification");
  const { error: jobError } = usePanelJobError(pageId, "text-classification");
  const currentVersionRef = useRef(initialVersion);

  const apiBase = `/api/books/${label}/pages/${pageId}/text-classification`;
  const { rerun: handleRerun, error: rerunError } = useRerun(apiBase);
  const busy = pipelineBusy || panelJobBusy;
  const error = jobError || rerunError;

  // Sync from server props when the pipeline produces new data
  useEffect(() => {
    if (isDirty) return;
    setData(initialData);
    setVersions(initialAvailableVersions);
    currentVersionRef.current = initialVersion;
  }, [initialData, initialVersion, initialAvailableVersions]);

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
        rerunLoading={busy}
        rerunDisabled={isDirty}
        onRerun={handleRerun}
        rerunTitle={data ? "Rerun classification" : "Run classification"}
        isDirty={isDirty}
        onDirtyDiscard={discardEdits}
        error={error}
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
            <div key={gi} className="rounded border border-border p-3">
              <TypeDropdown
                currentType={group.group_type}
                types={groupTypes}
                onSelect={(newType) => {
                  applyEdit((d) => {
                    d.groups[gi].group_type = newType;
                  });
                }}
              />
              <div className="ml-5 space-y-1.5">
                {group.texts.map((entry, ti) => (
                  <div
                    key={ti}
                    className={`group/entry flex items-start gap-1.5${entry.is_pruned ? " opacity-40 line-through" : ""}`}
                  >
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
