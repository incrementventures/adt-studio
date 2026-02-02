"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PageSectioning } from "@/lib/books";
import { TextTypeBadge } from "../extract/text-type-badge";
import { EditableText } from "../extract/editable-text";
import { TypeDropdown } from "../extract/type-dropdown";
import { LightboxImage } from "../extract/image-lightbox";
import { usePipelineBusy, usePanelJobBusy, usePanelJobError, useRerun } from "../use-pipeline-refresh";
import { NodeHeader, type VersionApi } from "../node-header";

/** Line-with-dot drop indicator (Notion / Linear style). */
function DropIndicator() {
  return (
    <div className="flex items-center gap-0 py-0.5">
      <div className="h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
      <div className="h-0.5 flex-1 bg-indigo-400 rounded-full" />
    </div>
  );
}

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

interface SectionsPanelProps {
  label: string;
  pageId: string;
  initialSectioning: PageSectioning | null;
  initialVersion: number;
  availableVersions: number[];
  extraction: PageTextClassification | null;
  imageIds: string[];
  sectionTypes: Record<string, string>;
  textTypes: string[];
  groupTypes: string[];
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
  textTypes,
  groupTypes,
}: SectionsPanelProps) {
  const [sectioning, setSectioning] = useState(initialSectioning);
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [isDirty, setIsDirty] = useState(false);
  const pipelineBusy = usePipelineBusy(pageId, "sections");
  const panelJobBusy = usePanelJobBusy(pageId, "page-sectioning");
  const { error: jobError } = usePanelJobError(pageId, "page-sectioning");
  const currentVersionRef = useRef(initialVersion);

  const apiBase = `/api/books/${label}/pages/${pageId}/page-sectioning`;
  const { rerun: handleRerun, error: rerunError } = useRerun(apiBase);
  const busy = pipelineBusy || panelJobBusy;
  const error = jobError || rerunError;
  const textDragRef = useRef<{ partId: string; fromIndex: number } | null>(null);
  const [textDragOver, setTextDragOver] = useState<{ partId: string; index: number } | null>(null);
  const partDragRef = useRef<{ sectionIndex: number; fromIndex: number } | null>(null);
  const [partDragOver, setPartDragOver] = useState<{ sectionIndex: number; index: number } | null>(null);

  // Sync from server props when the pipeline produces new data
  // (e.g. after router.refresh() from a batch run).
  // Skip if the user has unsaved local edits.
  useEffect(() => {
    if (isDirty) return;
    setSectioning(initialSectioning);
    setVersions(initialAvailableVersions);
    currentVersionRef.current = initialVersion;
  }, [initialSectioning, initialVersion, initialAvailableVersions]);

  const sectionTypeKeys = Object.keys(sectionTypes);

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

  // Build a lookup from group_id -> group data (from extraction)
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

  function ensureEmbeddedData(draft: PageSectioning) {
    if (!draft.groups) {
      draft.groups = {};
      const assignedIds = new Set(draft.sections.flatMap((s) => s.part_ids));
      for (const [id, g] of groupLookup) {
        const allTextsPruned = g.texts.length > 0 && g.texts.every((t) => t.is_pruned);
        draft.groups[id] = {
          ...JSON.parse(JSON.stringify(g)),
          is_pruned: !assignedIds.has(id) && allTextsPruned,
        };
      }
    }
    if (!draft.images) {
      const assignedIds = new Set(draft.sections.flatMap((s) => s.part_ids));
      draft.images = {};
      for (const imgId of imageIds) {
        if (!groupLookup.has(imgId)) {
          draft.images[imgId] = { is_pruned: !assignedIds.has(imgId) };
        }
      }
    }
    // Ensure every unpruned, unassigned group/image appears in some section.
    if (draft.sections.length > 0) {
      const assigned = new Set(draft.sections.flatMap((s) => s.part_ids));
      const missing = [
        ...Object.keys(draft.groups ?? {}).filter(
          (id) => !assigned.has(id) && !draft.groups![id].is_pruned
        ),
        ...Object.keys(draft.images ?? {}).filter(
          (id) => !assigned.has(id) && !draft.images![id].is_pruned
        ),
      ];
      if (missing.length > 0) {
        draft.sections[draft.sections.length - 1].part_ids.push(...missing);
      }
    }
  }

  function applyEdit(mutator: (draft: PageSectioning) => void) {
    setSectioning((prev) => {
      if (!prev) return prev;
      const next: PageSectioning = JSON.parse(JSON.stringify(prev));
      ensureEmbeddedData(next);
      mutator(next);
      return next;
    });
    setIsDirty(true);
  }

  async function discardEdits() {
    try {
      const json = await versionApi.loadVersion(currentVersionRef.current);
      const resp = json as { data: PageSectioning };
      setSectioning(resp.data);
    } catch {
      // ignore
    }
    setIsDirty(false);
  }

  function resolveGroup(partId: string): { group_type: string; texts: TextEntry[] } | undefined {
    return sectioning?.groups?.[partId] ?? groupLookup.get(partId);
  }

  function renderPartChunks(partIds: string[], sectionIndex?: number) {
    const canDragParts = sectionIndex != null;

    function partDragHandlers(pi: number) {
      if (!canDragParts) return {};
      const si = sectionIndex!;
      return {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          // Don't start part drag if a text drag is active
          if (textDragRef.current) { e.preventDefault(); return; }
          partDragRef.current = { sectionIndex: si, fromIndex: pi };
          e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e: React.DragEvent) => {
          if (!partDragRef.current || partDragRef.current.sectionIndex !== si) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setPartDragOver({ sectionIndex: si, index: pi });
        },
        onDragLeave: () => {
          setPartDragOver((prev) =>
            prev?.sectionIndex === si && prev.index === pi ? null : prev
          );
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          const src = partDragRef.current;
          if (!src || src.sectionIndex !== si || src.fromIndex === pi) {
            partDragRef.current = null;
            setPartDragOver(null);
            return;
          }
          applyEdit((d) => {
            const arr = d.sections[si].part_ids;
            const [item] = arr.splice(src.fromIndex, 1);
            arr.splice(pi, 0, item);
          });
          partDragRef.current = null;
          setPartDragOver(null);
        },
        onDragEnd: () => {
          partDragRef.current = null;
          setPartDragOver(null);
        },
      };
    }

    function isPartDropTarget(pi: number) {
      return canDragParts && partDragOver?.sectionIndex === sectionIndex && partDragOver.index === pi;
    }

    const items = partIds.map((partId, pi) => {
      const group = resolveGroup(partId);
      if (group) {
        const groupPruned = sectioning?.groups?.[partId]?.is_pruned ?? false;
        return (
          <div key={partId}>
            {isPartDropTarget(pi) && <DropIndicator />}
            <div className="group/group flex items-start gap-1.5" {...partDragHandlers(pi)}>
            {canDragParts && (
              <div className="mt-3 flex shrink-0 cursor-grab items-center active:cursor-grabbing opacity-0 group-hover/group:opacity-100">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-faint">
                  <path fillRule="evenodd" d="M2 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}
            <div className={`min-w-0 flex-1 rounded border border-border bg-background p-3${groupPruned ? " opacity-40" : ""}`}>
              <div className="group/group-header mb-1.5 flex items-center justify-between">
                <TypeDropdown
                  currentType={group.group_type}
                  types={groupTypes}
                  onSelect={(newType) => {
                    applyEdit((d) => {
                      if (d.groups?.[partId]) {
                        d.groups[partId].group_type = newType;
                      }
                    });
                  }}
                />
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-faint">
                    {partId}
                  </span>
                  <button
                    type="button"
                    title={
                      groupPruned
                        ? "Pruned — click to unprune group"
                        : "Click to prune group"
                    }
                    onClick={() =>
                      applyEdit((d) => {
                        if (d.groups?.[partId]) {
                          d.groups[partId].is_pruned = !groupPruned;
                        }
                      })
                    }
                    className={`shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-foreground transition-colors${groupPruned ? "" : " opacity-0 group-hover/group-header:opacity-100"}`}
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
              </div>
              <div className="space-y-0">
                {group.texts.map((entry, ti) => (
                  <div key={ti}>
                    {textDragOver?.partId === partId && textDragOver.index === ti && <DropIndicator />}
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        textDragRef.current = { partId, fromIndex: ti };
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (textDragRef.current?.partId !== partId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        setTextDragOver({ partId, index: ti });
                      }}
                      onDragLeave={() => {
                        setTextDragOver((prev) =>
                          prev?.partId === partId && prev.index === ti ? null : prev
                        );
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const src = textDragRef.current;
                        if (!src || src.partId !== partId || src.fromIndex === ti) {
                          textDragRef.current = null;
                          setTextDragOver(null);
                          return;
                        }
                        applyEdit((d) => {
                          if (d.groups?.[partId]) {
                            const arr = d.groups[partId].texts;
                            const [item] = arr.splice(src.fromIndex, 1);
                            arr.splice(ti, 0, item);
                          }
                        });
                        textDragRef.current = null;
                        setTextDragOver(null);
                      }}
                      onDragEnd={() => {
                        textDragRef.current = null;
                        setTextDragOver(null);
                      }}
                      className={`group/entry flex items-start gap-1.5 py-0.5${entry.is_pruned ? " opacity-40 line-through" : ""}`}
                    >
                    <div
                      className={`mt-0.5 flex shrink-0 cursor-grab items-center gap-0.5 active:cursor-grabbing ${entry.is_pruned ? "" : "opacity-0 group-hover/entry:opacity-100"}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-faint">
                        <path fillRule="evenodd" d="M2 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <EditableText
                      text={entry.text}
                      onSave={(newText) => {
                        applyEdit((d) => {
                          if (d.groups?.[partId]) {
                            d.groups[partId].texts[ti].text = newText;
                          }
                        });
                      }}
                    />
                    <div className="shrink-0">
                      <TextTypeBadge
                        label={label}
                        pageId={pageId}
                        groupIndex={0}
                        textIndex={ti}
                        currentType={entry.text_type}
                        textTypes={textTypes}
                        onTypeChange={(newType) => {
                          applyEdit((d) => {
                            if (d.groups?.[partId]) {
                              d.groups[partId].texts[ti].text_type = newType;
                            }
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
                          if (d.groups?.[partId]) {
                            d.groups[partId].texts[ti].is_pruned = !entry.is_pruned;
                          }
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
                  </div>
                ))}
                {group.texts.length > 0 && (
                  <div
                    onDragOver={(e) => {
                      if (textDragRef.current?.partId !== partId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      setTextDragOver({ partId, index: group.texts.length });
                    }}
                    onDragLeave={() => {
                      setTextDragOver((prev) =>
                        prev?.partId === partId && prev.index === group.texts.length ? null : prev
                      );
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const src = textDragRef.current;
                      const endIdx = group.texts.length;
                      if (!src || src.partId !== partId || src.fromIndex === endIdx) {
                        textDragRef.current = null;
                        setTextDragOver(null);
                        return;
                      }
                      applyEdit((d) => {
                        if (d.groups?.[partId]) {
                          const arr = d.groups[partId].texts;
                          const [item] = arr.splice(src.fromIndex, 1);
                          arr.splice(endIdx, 0, item);
                        }
                      });
                      textDragRef.current = null;
                      setTextDragOver(null);
                    }}
                    className="h-3"
                  >
                    {textDragOver?.partId === partId && textDragOver.index === group.texts.length && <DropIndicator />}
                  </div>
                )}
              </div>
            </div>
            </div>
          </div>
        );
      }
      // Image part
      const imgPruned = sectioning?.images?.[partId]?.is_pruned ?? false;
      return (
        <div key={partId}>
          {isPartDropTarget(pi) && <DropIndicator />}
          <div className="group/img flex items-start gap-1.5" {...partDragHandlers(pi)}>
          {canDragParts && (
            <div className="mt-3 flex shrink-0 cursor-grab items-center active:cursor-grabbing opacity-0 group-hover/img:opacity-100">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-faint">
                <path fillRule="evenodd" d="M2 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clipRule="evenodd" />
              </svg>
            </div>
          )}
          <div className="relative w-40">
            <LightboxImage
              src={`/api/books/${label}/pages/${pageId}/images/${partId}?v=${sectioning?.image_classification_version ?? ""}`}
              alt={partId}
              className={`w-full rounded-t border border-border${imgPruned ? " opacity-50" : ""}`}
              showDimensions
            />
            <button
              type="button"
              onClick={() =>
                applyEdit((d) => {
                  if (!d.images) d.images = {};
                  d.images[partId] = { is_pruned: !imgPruned };
                })
              }
              title={imgPruned ? "Unprune image" : "Prune image"}
              className={`absolute top-1.5 right-1.5 rounded-md p-1 transition-colors bg-red-500/80 text-white hover:bg-red-500 ${
                imgPruned ? "" : "invisible group-hover/img:visible"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M5.965 4.904l9.131 9.131a6.5 6.5 0 00-9.131-9.131zm8.07 10.192L4.904 5.965a6.5 6.5 0 009.131 9.131zM4.343 4.343a8 8 0 1111.314 11.314A8 8 0 014.343 4.343z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            </div>
          </div>
        </div>
      );
    });

    // Trailing drop zone so you can drop after the last item
    if (canDragParts && partIds.length > 0) {
      const endIdx = partIds.length;
      items.push(
        <div
          key="__drop-end"
          onDragOver={(e) => {
            if (!partDragRef.current || partDragRef.current.sectionIndex !== sectionIndex!) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setPartDragOver({ sectionIndex: sectionIndex!, index: endIdx });
          }}
          onDragLeave={() => {
            setPartDragOver((prev) =>
              prev?.sectionIndex === sectionIndex! && prev.index === endIdx ? null : prev
            );
          }}
          onDrop={(e) => {
            e.preventDefault();
            const src = partDragRef.current;
            if (!src || src.sectionIndex !== sectionIndex! || src.fromIndex === endIdx) {
              partDragRef.current = null;
              setPartDragOver(null);
              return;
            }
            applyEdit((d) => {
              const arr = d.sections[sectionIndex!].part_ids;
              const [item] = arr.splice(src.fromIndex, 1);
              arr.splice(endIdx, 0, item);
            });
            partDragRef.current = null;
            setPartDragOver(null);
          }}
          className="h-4"
        >
          {isPartDropTarget(endIdx) && <DropIndicator />}
        </div>
      );
    }

    return items;
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
          setIsDirty(false);
        }}
        onVersionSaved={(newVersion, newVersions, raw) => {
          const resp = raw as { data: PageSectioning };
          setSectioning(resp.data);
          currentVersionRef.current = newVersion;
          setVersions(newVersions);
          setIsDirty(false);
        }}
        rerunLoading={busy}
        rerunDisabled={isDirty}
        onRerun={handleRerun}
        rerunTitle={sectioning ? "Rerun sectioning" : "Run sectioning"}
        isDirty={isDirty}
        onDirtyDiscard={discardEdits}
        error={error}
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
                className={`group/section rounded-lg border border-border bg-surface/30${section.is_pruned ? " opacity-40" : ""}`}
              >
                {/* Section header */}
                <div className="group/section-header flex items-center gap-2 px-4 py-2.5">
                  <TypeDropdown
                    currentType={section.section_type}
                    types={sectionTypeKeys}
                    onSelect={(newType) => {
                      applyEdit((d) => {
                        d.sections[si].section_type = newType;
                      });
                    }}
                    className="relative"
                  />
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
                  <button
                    type="button"
                    title={
                      section.is_pruned
                        ? "Pruned — click to unprune"
                        : "Click to prune section"
                    }
                    onClick={() =>
                      applyEdit((d) => {
                        d.sections[si].is_pruned = !section.is_pruned;
                      })
                    }
                    className={`shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-foreground transition-colors${section.is_pruned ? "" : " opacity-0 group-hover/section-header:opacity-100"}`}
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

                {/* Section content — assigned parts, then unassigned parts pruned */}
                <div className="space-y-3 px-4 pb-4">
                  {section.part_ids.length === 0 && (
                    <p className="text-sm italic text-faint">
                      No parts assigned to this section.
                    </p>
                  )}
                  {renderPartChunks(section.part_ids, si)}
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
