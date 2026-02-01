"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SectionRendering } from "@/lib/books";
import type { Annotation } from "@/lib/pipeline/web-rendering/edit-section";
import {
  SectionAnnotationEditor,
  type SectionAnnotationEditorHandle,
} from "./section-annotation-editor";

export interface EnrichedSection extends SectionRendering {
  version: number;
  versions: number[];
}

interface WebRenderingPanelProps {
  label: string;
  pageId: string;
  sections: EnrichedSection[] | null;
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
  label,
  pageId,
  isEditing,
  editLoading,
  onToggleEdit,
  onCancelEdit,
  onEditSubmit,
  onHeightChange,
  iframeHeight,
  initialVersion,
  initialVersions,
  onSectionUpdated,
}: {
  section: SectionRendering;
  label: string;
  pageId: string;
  isEditing: boolean;
  editLoading: boolean;
  onToggleEdit: () => void;
  onCancelEdit: () => void;
  onEditSubmit: (imageBase64: string, annotations: Annotation[]) => void;
  onHeightChange: (h: number) => void;
  iframeHeight: number;
  initialVersion: number;
  initialVersions: number[];
  onSectionUpdated: (section: SectionRendering, version: number, versions: number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SectionAnnotationEditorHandle>(null);
  const [canSubmitEdit, setCanSubmitEdit] = useState(false);
  const [version, setVersion] = useState(initialVersion);
  const [versions, setVersions] = useState(initialVersions);
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);

  const versionLabel = version === 1 ? "original" : `v${version}`;
  const sectionId = `${pageId}_s${String(section.section_index).padStart(3, "0")}`;

  // Sync from parent when props change (e.g. after router.refresh())
  useEffect(() => {
    setVersion(initialVersion);
    setVersions(initialVersions);
  }, [initialVersion, initialVersions]);

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

  async function loadVersion(v: number) {
    setVersionDropdownOpen(false);
    if (v === version) return;
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/web-rendering/version`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectionId, version: v }),
        }
      );
      if (!res.ok) return;
      const json = await res.json();
      setVersion(v);
      onSectionUpdated(json.section, v, versions);
    } catch {
      // ignore
    }
  }

  if (!section.html) {
    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2 bg-surface/30">
          <p className="text-xs italic text-muted">{section.reasoning || "Empty section"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center px-4 py-2 bg-surface/30">
        <span className="text-xs font-medium uppercase tracking-wider text-faint">
          {section.section_type.replace(/_/g, " ")}
        </span>
        {!isEditing && versions.length > 1 && (
          <div ref={versionDropdownRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setVersionDropdownOpen(!versionDropdownOpen)}
              className="cursor-pointer rounded bg-surface/60 px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-surface hover:text-foreground transition-colors"
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
                    {v === 1 ? "original" : `v${v}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {isEditing && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={editLoading}
              className="cursor-pointer rounded px-2 py-0.5 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => editorRef.current?.submit()}
              disabled={editLoading || !canSubmitEdit}
              className="cursor-pointer rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {editLoading ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>
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
          srcDoc={buildSrcDoc(section.html, label, pageId)}
          onHeightChange={onHeightChange}
          initialHeight={iframeHeight}
        />
        {isEditing && (
          <>
            {editLoading && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
                <div className="rounded bg-white px-4 py-2 text-sm font-medium shadow">
                  Updating section...
                </div>
              </div>
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
  sections: initialSections,
}: WebRenderingPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function handleRerun() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/web-rendering`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      setSections(json.sections ?? []);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleEditSubmit(
    sectionIndex: number,
    currentHtml: string,
    annotationImageBase64: string,
    annotations: Annotation[]
  ) {
    setEditLoading(true);
    setError(null);
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
      const { section: updatedSection, version: newVersion, versions: newVersions } = await res.json();
      setSections((prev) =>
        prev.map((s) =>
          s.section_index === sectionIndex
            ? { ...updatedSection, version: newVersion, versions: newVersions }
            : s
        )
      );
      setEditingSection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setEditLoading(false);
    }
  }

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center gap-2 bg-slate-700 px-4 py-2 text-sm font-semibold text-white">
        <span>Web Pages</span>
        {error && (
          <span className="text-xs font-normal text-red-200">{error}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleRerun}
          disabled={loading}
          className="cursor-pointer rounded p-1 text-white/80 hover:text-white hover:bg-slate-600 disabled:opacity-50 transition-colors"
          title={initialSections ? "Rerun web rendering" : "Run web rendering"}
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
      </div>

      {initialSections === null ? (
        <p className="p-4 text-sm italic text-muted">
          No web rendering yet. Click the refresh button to run rendering.
        </p>
      ) : (
        <div className="space-y-4 p-4">
          {sections.map((section) => (
            <SectionCard
              key={section.section_index}
              section={section}
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
