"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { SectionRendering } from "@/lib/books";
import type { Annotation } from "@/lib/pipeline/actions";
import {
  SectionAnnotationEditor,
  type SectionAnnotationEditorHandle,
} from "./section-annotation-editor";
import { usePipelineBusy, useSectionBusy, useAnySectionBusy, useRerun } from "../use-pipeline-refresh";
import { NodeHeader, type VersionApi } from "../node-header";

export interface EnrichedSection extends SectionRendering {
  version: number;
  versions: number[];
}

interface WebRenderingPanelProps {
  label: string;
  pageId: string;
  pageNumber?: number;
  sections: EnrichedSection[] | null;
  panelToggles?: { images: boolean; text: boolean; sections: boolean };
  panelBusy?: { images: boolean; text: boolean; sections: boolean };
  panelLoaded?: { images: boolean; text: boolean; sections: boolean };
  onTogglePanel?: (panel: "images" | "text" | "sections") => void;
}

/**
 * Replace placeholder src attributes on <img> tags that have a data-id
 * with the real image-serving API URL.
 */
function substituteImageSrcs(
  html: string,
  label: string,
  pageId: string
): string {
  return html.replace(/<img\b([^>]*)>/gi, (match, attrs: string) => {
    const dataIdMatch = attrs.match(/data-id="([^"]+)"/);
    if (!dataIdMatch) return match;
    const imageId = dataIdMatch[1];
    const src = `/api/books/${label}/pages/${pageId}/images/${imageId}`;
    const newAttrs = /src="[^"]*"/.test(attrs)
      ? attrs.replace(/src="[^"]*"/, `src="${src}"`)
      : `${attrs} src="${src}"`;
    return `<img${newAttrs}>`;
  });
}

const TAILWIND_CDN =
  '<script src="https://cdn.tailwindcss.com"><\/script>';

function buildSrcDoc(html: string, label: string, pageId: string): string {
  const resolved = substituteImageSrcs(html, label, pageId);
  // The injected script uses a ResizeObserver on <body> to post its
  // scrollHeight to the parent so the iframe can grow to fit content.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${TAILWIND_CDN}
<style>html, body { margin: 0; overflow: hidden; }</style>
</head>
<body><div id="__wrap">${resolved}</div>
<script>
var wrap = document.getElementById("__wrap");
var last = 0;
new ResizeObserver(function() {
  var h = wrap.offsetHeight;
  if (h !== last) { last = h; window.parent.postMessage({ type: "iframe-resize", height: h }, "*"); }
}).observe(wrap);
<\/script>
</body>
</html>`;
}

function SandboxedSection({
  srcDoc,
  onHeightChange,
  initialHeight,
}: {
  srcDoc: string;
  onHeightChange?: (height: number) => void;
  initialHeight?: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight ?? 0);

  const onMessage = useCallback(
    (e: MessageEvent) => {
      if (
        e.source === iframeRef.current?.contentWindow &&
        e.data?.type === "iframe-resize"
      ) {
        setHeight(e.data.height);
        onHeightChange?.(e.data.height);
      }
    },
    [onHeightChange]
  );

  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onMessage]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      scrolling="no"
      className="w-full border-0 block"
      style={{ height: height > 0 ? `${height}px` : "150px", overflow: "hidden" }}
    />
  );
}

function SectionCard({
  section,
  sectionNumber,
  label,
  pageId,
  isEditing,
  editLoading,
  onToggleEdit,
  onCancelEdit,
  onEditSubmit,
  onRerun,
  onHeightChange,
  iframeHeight,
  initialVersion,
  initialVersions,
  onSectionUpdated,
}: {
  section: SectionRendering;
  sectionNumber: number;
  label: string;
  pageId: string;
  isEditing: boolean;
  editLoading: boolean;
  onToggleEdit: () => void;
  onCancelEdit: () => void;
  onEditSubmit: (imageBase64: string, annotations: Annotation[]) => void;
  onRerun: () => void;
  onHeightChange: (h: number) => void;
  iframeHeight: number;
  initialVersion: number;
  initialVersions: number[];
  onSectionUpdated: (section: SectionRendering, version: number, versions: number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SectionAnnotationEditorHandle>(null);
  const [canSubmitEdit, setCanSubmitEdit] = useState(false);
  const [displayedHtml, setDisplayedHtml] = useState(section.html);
  const sectionBusy = useSectionBusy(pageId, section.section_index);

  const sectionId = `${pageId}_s${String(section.section_index + 1).padStart(3, "0")}`;

  // Sync displayed HTML from parent when props change (e.g. after rerun/edit)
  useEffect(() => {
    setDisplayedHtml(section.html);
  }, [section.html]);

  const versionApi: VersionApi = useMemo(() => ({
    loadVersion: async (v: number) => {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/web-rendering/version?sectionId=${sectionId}&version=${v}`
      );
      if (!res.ok) throw new Error("Failed to load version");
      return res.json();
    },
    saveVersion: async (v: number) => {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/web-rendering/version`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectionId, version: v }),
        }
      );
      if (!res.ok) throw new Error("Failed to save version");
      return res.json();
    },
  }), [label, pageId, sectionId]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <NodeHeader
        title={`Section ${sectionNumber}`}
        initialVersion={initialVersion}
        initialVersions={initialVersions}
        versionApi={versionApi}
        onVersionLoaded={(_v, data) => {
          const json = data as { section: SectionRendering };
          setDisplayedHtml(json.section.html);
        }}
        onVersionSaved={(newVersion, newVersions, data) => {
          const json = data as { section: SectionRendering };
          setDisplayedHtml(json.section.html);
          onSectionUpdated(json.section, newVersion, newVersions);
        }}
        rerunLoading={sectionBusy || editLoading}
        rerunDisabled={editLoading}
        onRerun={onRerun}
        rerunTitle="Rerun section"
        isDirty={isEditing}
        onDirtyDiscard={onCancelEdit}
        onDirtySave={() => editorRef.current?.submit()}
        saveDisabled={!canSubmitEdit || editLoading}
      />
      <div
        ref={containerRef}
        className="group relative"
        style={{ minHeight: isEditing ? iframeHeight : undefined }}
      >
        {!isEditing && (
          <button
            type="button"
            onClick={onToggleEdit}
            disabled={editLoading}
            className="absolute right-1.5 top-1.5 z-10 cursor-pointer rounded-md p-1 bg-blue-500/80 text-white opacity-0 transition-all group-hover:opacity-100 hover:bg-blue-500 disabled:opacity-0"
            title="Edit section"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.261-4.262a1.75 1.75 0 0 0 0-2.474Z" />
              <path d="M4.75 3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9A.75.75 0 0 1 14 9v2.25A2.75 2.75 0 0 1 11.25 14h-6.5A2.75 2.75 0 0 1 2 11.25v-6.5A2.75 2.75 0 0 1 4.75 2H7a.75.75 0 0 1 0 1.5H4.75Z" />
            </svg>
          </button>
        )}
        <SandboxedSection
          srcDoc={buildSrcDoc(displayedHtml, label, pageId)}
          onHeightChange={onHeightChange}
          initialHeight={iframeHeight}
        />
        {isEditing && (
          <>
            {editLoading && (
              <div className="absolute inset-0 z-30 bg-black/40" />
            )}
            <SectionAnnotationEditor
              ref={editorRef}
              containerWidth={containerRef.current?.clientWidth ?? 800}
              containerHeight={iframeHeight}
              onSubmit={onEditSubmit}
              onCanSubmitChange={setCanSubmitEdit}
            />
          </>
        )}
      </div>
      {section.reasoning && (
        <div className="border-t border-border px-4 py-2">
          <p className="whitespace-pre-wrap text-xs text-muted">{section.reasoning}</p>
        </div>
      )}
    </div>
  );
}

export function WebRenderingPanel({
  label,
  pageId,
  pageNumber,
  sections: initialSections,
  panelToggles,
  panelBusy,
  panelLoaded,
  onTogglePanel,
}: WebRenderingPanelProps) {
  const pipelineBusy = usePipelineBusy(pageId, "web-rendering");
  const anySectionBusy = useAnySectionBusy(pageId);
  const { rerun: rerunAll, error: rerunAllError } = useRerun(
    `/api/books/${label}/pages/${pageId}/web-rendering`
  );
  const [editError, setEditError] = useState<string | null>(null);
  const error = rerunAllError || editError;
  const [sections, setSections] = useState<EnrichedSection[]>(
    initialSections ?? []
  );
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const sectionHeights = useRef<Map<number, number>>(new Map());

  // Sync sections when initialSections changes (e.g. after router.refresh())
  useEffect(() => {
    setSections(initialSections ?? []);
  }, [initialSections]);

  const busy = pipelineBusy || anySectionBusy;

  async function handleRerunSection(sectionIndex: number) {
    setEditError(null);
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/web-rendering/${sectionIndex}/rerun`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleEditSubmit(
    sectionIndex: number,
    currentHtml: string,
    annotationImageBase64: string,
    annotations: Annotation[]
  ) {
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/web-rendering/${sectionIndex}/edit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            annotationImageBase64,
            annotations,
            currentHtml,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Edit failed (${res.status})`);
      }
      const { jobId } = await res.json();
      if (!jobId) throw new Error("No job ID returned");

      const es = new EventSource(`/api/queue?jobId=${jobId}`);
      es.addEventListener("job", (e) => {
        try {
          const job = JSON.parse(e.data);
          if (job.status === "completed") {
            const { section: updatedSection, version: newVersion, versions: newVersions } = job.result as {
              section: EnrichedSection;
              version: number;
              versions: number[];
            };
            setSections((prev) =>
              prev.map((s) =>
                s.section_index === sectionIndex
                  ? { ...updatedSection, version: newVersion, versions: newVersions }
                  : s
              )
            );
            setEditingSection(null);
            setEditLoading(false);
            es.close();
          } else if (job.status === "failed") {
            setEditError(job.error ?? "Edit failed");
            setEditLoading(false);
            es.close();
          }
        } catch { /* skip */ }
      });
      es.onerror = () => {
        setEditError("Connection to job queue lost");
        setEditLoading(false);
        es.close();
      };
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Unknown error");
      setEditLoading(false);
    }
  }

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center gap-2 bg-slate-700 px-4 py-2 text-sm font-semibold text-white">
        <span>{pageNumber != null ? `Page ${pageNumber}` : "Web Pages"}</span>
        {error && (
          <span className="text-xs font-normal text-red-200">{error}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
        {onTogglePanel && (
          <>
            {(["images", "text", "sections"] as const).map((panel) => {
              const colors =
                panel === "images" ? { fill: "bg-amber-600", border: "border-amber-500", text: "text-amber-400", hoverText: "hover:text-amber-300" } :
                panel === "text" ? { fill: "bg-indigo-600", border: "border-indigo-500", text: "text-indigo-400", hoverText: "hover:text-indigo-300" } :
                { fill: "bg-teal-600", border: "border-teal-500", text: "text-teal-400", hoverText: "hover:text-teal-300" };
              const busy = panelBusy?.[panel];
              const loaded = panelLoaded?.[panel];
              const open = panelToggles?.[panel];
              let cls: string;
              if (busy) {
                cls = `${colors.border} border ${colors.text} animate-pulse`;
              } else if (!loaded) {
                cls = "border border-white/10 text-white/25 cursor-default";
              } else if (open) {
                cls = `${colors.fill} text-white border border-transparent`;
              } else {
                cls = `${colors.border} border ${colors.text} ${colors.hoverText}`;
              }
              return (
                <button
                  key={panel}
                  type="button"
                  onClick={() => loaded && onTogglePanel(panel)}
                  disabled={!loaded && !busy}
                  className={`rounded px-1.5 py-0.5 text-xs transition-colors ${cls} ${loaded ? "cursor-pointer" : ""}`}
                >
                  {panel === "images" ? "Images" : panel === "text" ? "Text" : "Sections"}
                </button>
              );
            })}
          </>
        )}
        <button
          type="button"
          onClick={rerunAll}
          disabled={busy}
          className="cursor-pointer rounded p-1 text-white/80 hover:text-white hover:bg-slate-600 disabled:opacity-50 transition-colors"
          title={initialSections ? "Rerun web rendering" : "Run web rendering"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.434l.311.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.311H11.768a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.53a.75.75 0 00-1.5 0v2.434l-.311-.312A7 7 0 002.629 8.79a.75.75 0 001.449.39z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        </div>
      </div>

      {initialSections === null ? (
        <div className="space-y-6 p-6">
          {/* Skeleton header */}
          <div className="h-6 w-1/3 rounded bg-muted/30 animate-pulse" />
          {/* Skeleton text lines */}
          <div className="space-y-2.5">
            <div className="h-3.5 w-full rounded bg-muted/20 animate-pulse" />
            <div className="h-3.5 w-5/6 rounded bg-muted/20 animate-pulse" />
            <div className="h-3.5 w-4/6 rounded bg-muted/20 animate-pulse" />
          </div>
          {/* Skeleton image + text row */}
          <div className="flex gap-4">
            <div className="h-32 w-40 shrink-0 rounded bg-muted/15 animate-pulse" />
            <div className="flex-1 space-y-2.5 py-1">
              <div className="h-3.5 w-full rounded bg-muted/20 animate-pulse" />
              <div className="h-3.5 w-5/6 rounded bg-muted/20 animate-pulse" />
              <div className="h-3.5 w-4/6 rounded bg-muted/20 animate-pulse" />
              <div className="h-3.5 w-3/4 rounded bg-muted/20 animate-pulse" />
            </div>
          </div>
        </div>
      ) : sections.every((s) => !s.html) ? (
        <p className="p-4 text-sm italic text-muted">
          No sections found for this page to render.
        </p>
      ) : (
        <div className="space-y-4 p-4">
          {sections.filter((s) => s.html).map((section, idx) => (
            <SectionCard
              key={section.section_index}
              section={section}
              sectionNumber={idx + 1}
              label={label}
              pageId={pageId}
              isEditing={editingSection === section.section_index}
              editLoading={editLoading}
              initialVersion={section.version}
              initialVersions={section.versions}
              onToggleEdit={() =>
                setEditingSection(
                  editingSection === section.section_index
                    ? null
                    : section.section_index
                )
              }
              onCancelEdit={() => setEditingSection(null)}
              onEditSubmit={(imageBase64, annotations) =>
                handleEditSubmit(
                  section.section_index,
                  section.html,
                  imageBase64,
                  annotations
                )
              }
              onRerun={() => handleRerunSection(section.section_index)}
              onSectionUpdated={(updatedSection, newVersion, newVersions) => {
                setSections((prev) =>
                  prev.map((s) =>
                    s.section_index === section.section_index
                      ? { ...updatedSection, version: newVersion, versions: newVersions }
                      : s
                  )
                );
              }}
              onHeightChange={(h) => {
                sectionHeights.current.set(section.section_index, h);
              }}
              iframeHeight={
                sectionHeights.current.get(section.section_index) ?? 200
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
