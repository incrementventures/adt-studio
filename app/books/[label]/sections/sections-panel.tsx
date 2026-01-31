"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PageSectioning } from "@/lib/books";
import { TEXT_TYPE_COLORS } from "../extract/text-type-badge";

interface TextEntry {
  text_type: string;
  text: string;
  is_pruned?: boolean;
}

interface TextGroup {
  group_id?: string;
  group_type: string;
  texts: TextEntry[];
}

interface PageTextExtraction {
  reasoning: string;
  groups: TextGroup[];
}

function badgeColor(textType: string): string {
  return TEXT_TYPE_COLORS[textType] ?? TEXT_TYPE_COLORS.other;
}

interface SectionsPanelProps {
  label: string;
  pageId: string;
  sectioning: PageSectioning | null;
  extraction: PageTextExtraction | null;
  imageIds: string[];
  sectionTypes: Record<string, string>;
}

function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function SectionsPanel({
  label,
  pageId,
  sectioning: initialSectioning,
  extraction,
  imageIds,
  sectionTypes,
}: SectionsPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectioning = initialSectioning;

  async function handleRerun() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/page-sectioning`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      await res.json();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
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
      {/* Sections header bar */}
      <div className="flex items-center gap-2 bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
        <span>Sections</span>
        {error && (
          <span className="text-xs font-normal text-red-200">{error}</span>
        )}
        <button
          type="button"
          onClick={handleRerun}
          disabled={loading}
          className="ml-auto cursor-pointer rounded p-1 text-white/80 hover:text-white hover:bg-teal-500 disabled:opacity-50 transition-colors"
          title={sectioning ? "Rerun sectioning" : "Run sectioning"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.434l.311.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.311H11.768a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.53a.75.75 0 00-1.5 0v2.434l-.311-.312A7 7 0 002.629 8.79a.75.75 0 001.449.39z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {sectioning ? (
        <div className="space-y-4 p-4">
          {sectioning.sections.map((section, si) => {
            const bgColor = section.background_color || "#ffffff";
            const txtColor = section.text_color || "#000000";
            const typeDescription = sectionTypes[section.section_type] ?? "";

            const groupParts = section.part_ids.filter((id) =>
              id.includes("_gp")
            );
            const imageParts = section.part_ids.filter(
              (id) => !id.includes("_gp")
            );

            return (
              <div
                key={si}
                className="rounded-lg border border-border bg-surface/30"
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

                {/* Section content */}
                <div className="grid gap-6 px-4 pb-4 lg:grid-cols-[280px_1fr]">
                  {/* Left: images */}
                  <div className="space-y-2">
                    {imageParts.length > 0 ? (
                      imageParts.map((imageId) => (
                        <div key={imageId} className="space-y-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/books/${label}/pages/${pageId}/images/${imageId}`}
                            alt={imageId}
                            className="w-full rounded border border-border"
                          />
                          <span className="block text-center font-mono text-[10px] text-faint">
                            {imageId}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs italic text-faint">No images</p>
                    )}
                  </div>

                  {/* Right: text groups */}
                  <div className="space-y-3">
                    {groupParts.map((partId) => {
                      const group = groupLookup.get(partId);
                      return (
                        <div key={partId} className="rounded border border-border bg-background p-3">
                          <div className="mb-1.5 flex items-center justify-between">
                            {group && (
                              <span className="text-xs font-medium uppercase tracking-wider text-faint">
                                {group.group_type}
                              </span>
                            )}
                            <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-faint">
                              {partId}
                            </span>
                          </div>
                          {group ? (
                            <div className="space-y-1.5">
                              {group.texts.map((entry, ti) => (
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
                          ) : (
                            <p className="text-sm italic text-faint">
                              Group not found in extraction
                            </p>
                          )}
                        </div>
                      );
                    })}

                    {section.part_ids.length === 0 && (
                      <p className="text-sm italic text-faint">
                        No parts assigned to this section.
                      </p>
                    )}
                  </div>
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
