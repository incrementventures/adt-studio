"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PageSectioning } from "@/lib/books";
import { TEXT_TYPE_COLORS } from "../extract/text-type-badge";
import { LightboxImage } from "../extract/image-lightbox";
import { usePipelineBusy } from "../use-pipeline-refresh";
import { NodeHeader, type VersionApi } from "../node-header";

interface TextEntry {
  text_type: string;
  text: string;
  is_pruned: boolean;
}

interface TextGroup {
  group_id?: string;
  group_type: string;
  texts: TextEntry[];
}

interface PageTextClassification {
  reasoning: string;
  groups: TextGroup[];
}

function badgeColor(textType: string): string {
  return TEXT_TYPE_COLORS[textType] ?? TEXT_TYPE_COLORS.other;
}

interface SectionsPanelProps {
  label: string;
  pageId: string;
  initialSectioning: PageSectioning | null;
  initialVersion: number;
  availableVersions: number[];
  extraction: PageTextClassification | null;
  imageIds: string[];
  sectionTypes: Record<string, string>;
}

export function SectionsPanel({
  label,
  pageId,
  initialSectioning,
  initialVersion,
  availableVersions: initialAvailableVersions,
  extraction,
  imageIds,
  sectionTypes,
}: SectionsPanelProps) {
  const router = useRouter();
  const [sectioning, setSectioning] = useState(initialSectioning);
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const pipelineBusy = usePipelineBusy(pageId, "sections");
  const currentVersionRef = useRef(initialVersion);

  const apiBase = `/api/books/${label}/pages/${pageId}/page-sectioning`;

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
        body: JSON.stringify({ data: sectioning }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
  }), [apiBase, sectioning]);

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
              version: number; versions: number[]; data: PageSectioning;
            };
            setSectioning(newData);
            currentVersionRef.current = newVersion;
            setVersions(newVersions);
            setRerunning(false);
            router.refresh();
            es.close();
          } else if (job.status === "failed") {
            setRerunError(job.error ?? "Sectioning failed");
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

  // Build a lookup from group_id -> group data
  const groupLookup = new Map<
    string,
    { group_type: string; texts: TextEntry[] }
  >();
  if (extraction) {
    extraction.groups.forEach((g, idx) => {
      const groupId =
        g.group_id ??
        pageId + "_gp" + String(idx + 1).padStart(3, "0");
      groupLookup.set(groupId, { group_type: g.group_type, texts: g.texts });
    });
  }

  return (
    <div>
      <NodeHeader
        title="Sections"
        color="teal"
        initialVersion={initialVersion}
        initialVersions={versions}
        versionApi={versionApi}
        onVersionLoaded={(v, raw) => {
          const resp = raw as { data: PageSectioning };
          setSectioning(resp.data);
          currentVersionRef.current = v;
        }}
        onVersionSaved={(newVersion, newVersions, raw) => {
          const resp = raw as { data: PageSectioning };
          setSectioning(resp.data);
          currentVersionRef.current = newVersion;
          setVersions(newVersions);
        }}
        rerunLoading={rerunning || pipelineBusy}
        onRerun={handleRerun}
        rerunTitle={sectioning ? "Rerun sectioning" : "Run sectioning"}
        error={rerunError}
      />

      {sectioning ? (
        <div className="space-y-4 p-4">
          {sectioning.sections.length === 0 && (
            <p className="text-sm italic text-muted">
              No sections found for this page.
            </p>
          )}
          {sectioning.sections.map((section, si) => {
            const bgColor = section.background_color || "#ffffff";
            const txtColor = section.text_color || "#000000";
            const typeDescription = sectionTypes[section.section_type] ?? "";

            return (
              <div
                key={si}
                className={`rounded-lg border border-border bg-surface/30${section.is_pruned ? " opacity-40" : ""}`}
              >
                {/* Section header */}
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-faint">
                    {section.section_type.replace(/_/g, " ")}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3.5 w-3.5 rounded border border-border"
                      style={{ backgroundColor: bgColor }}
                      title={`Background: ${bgColor}`}
                    />
                    <span
                      className="inline-block h-3.5 w-3.5 rounded border border-border"
                      style={{ backgroundColor: txtColor }}
                      title={`Text: ${txtColor}`}
                    />
                  </div>
                  {section.page_number != null && (
                    <span className="text-xs text-faint">
                      p. {section.page_number}
                    </span>
                  )}
                  {typeDescription && (
                    <span className="ml-auto text-xs italic text-faint">
                      {typeDescription}
                    </span>
                  )}
                </div>

                {/* Section content — parts in order, consecutive images grouped */}
                <div className="space-y-3 px-4 pb-4">
                  {section.part_ids.length === 0 && (
                    <p className="text-sm italic text-faint">
                      No parts assigned to this section.
                    </p>
                  )}
                  {(() => {
                    const result: ({ type: "text"; partId: string; group: { group_type: string; texts: TextEntry[] } }
                      | { type: "images"; partIds: string[] })[] = [];
                    for (const partId of section.part_ids) {
                      const group = groupLookup.get(partId);
                      if (group) {
                        result.push({ type: "text", partId, group });
                      } else {
                        const last = result[result.length - 1];
                        if (last && last.type === "images") {
                          last.partIds.push(partId);
                        } else {
                          result.push({ type: "images", partIds: [partId] });
                        }
                      }
                    }
                    return result.map((chunk) => {
                      if (chunk.type === "text") {
                        return (
                          <div key={chunk.partId} className="rounded border border-border bg-background p-3">
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-xs font-medium uppercase tracking-wider text-faint">
                                {chunk.group.group_type}
                              </span>
                              <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-faint">
                                {chunk.partId}
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              {chunk.group.texts.map((entry, ti) => (
                                <div
                                  key={ti}
                                  className={`flex items-start justify-between gap-3${entry.is_pruned ? " opacity-40 line-through" : ""}`}
                                >
                                  <span className="flex-1 font-mono text-xs whitespace-pre-wrap">
                                    {entry.text}
                                  </span>
                                  <span
                                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor(entry.text_type)}`}
                                  >
                                    {entry.text_type}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={chunk.partIds[0]} className="flex flex-wrap gap-2">
                          {chunk.partIds.map((partId) => (
                            <div key={partId} className="w-40">
                              <LightboxImage
                                src={`/api/books/${label}/pages/${pageId}/images/${partId}?v=${sectioning?.image_classification_version ?? ""}`}
                                alt={partId}
                                className="w-full rounded-t border border-border"
                                showDimensions
                              />
                            </div>
                          ))}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            );
          })}

          {/* Reasoning collapsible */}
          {sectioning.reasoning && (
            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-muted hover:text-foreground">
                LLM Reasoning
              </summary>
              <p className="px-4 pb-3 text-xs text-muted whitespace-pre-wrap">
                {sectioning.reasoning}
              </p>
            </details>
          )}
        </div>
      ) : (
        <p className="p-4 text-sm italic text-muted">
          No sections yet. Click the refresh button to run sectioning.
        </p>
      )}
    </div>
  );
}
