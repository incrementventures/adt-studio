"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ImageEntry,
  PageImageClassification,
} from "@/lib/pipeline/image-classification/image-classification-schema";
import { ImageCropDialog } from "./image-crop-dialog";

interface ImageClassificationPanelProps {
  label: string;
  pageId: string;
  pageIndex: number;
  imageIds: string[];
  initialClassification: PageImageClassification | null;
  initialVersion: number;
  availableVersions: number[];
}

export function ImageClassificationPanel({
  label,
  pageId,
  pageIndex,
  imageIds,
  initialClassification,
  initialVersion,
  availableVersions: initialAvailableVersions,
}: ImageClassificationPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<PageImageClassification | null>(
    initialClassification
  );
  const [version, setVersion] = useState(initialVersion);
  const [latestVersion, setLatestVersion] = useState(initialVersion);
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropImageId, setCropImageId] = useState<string | null>(null);
  const [pendingCrops, setPendingCrops] = useState<Set<string>>(new Set());
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);

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

  const apiBase = `/api/books/${label}/pages/${pageId}/image-classification`;

  async function handleRerun() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(apiBase, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      const { version: newVersion, ...rest } = json;
      setData(rest as PageImageClassification);
      setVersion(newVersion);
      setLatestVersion(newVersion);
      setVersions([1]);
      setIsDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  async function loadVersion(v: number) {
    setVersionDropdownOpen(false);
    if (v === version) return;
    try {
      const res = await fetch(apiBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: v }),
      });
      if (!res.ok) return;
      const json = await res.json();
      setData(json.data as PageImageClassification);
      setVersion(v);
      setIsDirty(v !== latestVersion);
    } catch {
      // ignore
    }
  }

  function togglePruned(imageId: string) {
    setData((prev) => {
      if (!prev) return prev;
      const next: PageImageClassification = JSON.parse(JSON.stringify(prev));
      const img = next.images.find((i) => i.image_id === imageId);
      if (img) img.is_pruned = !img.is_pruned;
      return next;
    });
    setIsDirty(true);
  }

  function updateCrop(
    sourceId: string,
    crop: { x: number; y: number; width: number; height: number } | undefined
  ) {
    if (!crop) {
      setCropImageId(null);
      return;
    }

    let cropId = "";
    setData((prev) => {
      const next: PageImageClassification = JSON.parse(
        JSON.stringify(prev ?? { images: [] })
      );

      // Find max _imNNN number across disk imageIds and current entries
      const imRe = /_im(\d{3})$/;
      let maxNum = 0;
      for (const id of imageIds) {
        const m = imRe.exec(id);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
      for (const entry of next.images) {
        const m = imRe.exec(entry.image_id);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
      cropId = `${pageId}_im${String(maxNum + 1).padStart(3, "0")}`;

      const newEntry: ImageEntry = {
        image_id: cropId,
        path: `image-classification/${cropId}.png`,
        width: crop.width,
        height: crop.height,
        is_pruned: false,
        source_image_id: sourceId,
        source_region: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
      };

      // Insert after the source image if it exists, otherwise append
      const sourceIdx = next.images.findIndex((i) => i.image_id === sourceId);
      if (sourceIdx >= 0) {
        next.images[sourceIdx].is_pruned = true;
        next.images.splice(sourceIdx + 1, 0, newEntry);
      } else {
        next.images.push(newEntry);
      }

      return next;
    });
    setPendingCrops((prev) => new Set(prev).add(cropId));
    setIsDirty(true);
    setCropImageId(null);
  }

  async function discardEdits() {
    try {
      const res = await fetch(apiBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: latestVersion }),
      });
      if (!res.ok) return;
      const json = await res.json();
      setData(json.data as PageImageClassification);
      setVersion(latestVersion);
    } catch {
      // ignore
    }
    setPendingCrops(new Set());
    setIsDirty(false);
  }

  async function saveChanges() {
    setSaving(true);
    try {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, baseVersion: version }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const { version: newVersion, ...rest } = json;
      setData(rest as PageImageClassification);
      setVersion(newVersion);
      setLatestVersion(newVersion);
      setIsDirty(false);
      setPendingCrops(new Set());
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

  const rerunButton = (
    <button
      type="button"
      onClick={handleRerun}
      disabled={running || isDirty}
      className="cursor-pointer rounded p-1 text-white/80 hover:text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
      title={data ? "Rerun image classification" : "Run image classification"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-4 w-4 ${running ? "animate-spin" : ""}`}
      >
        <path
          fillRule="evenodd"
          d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.434l.311.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.311H11.768a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.53a.75.75 0 00-1.5 0v2.434l-.311-.312A7 7 0 002.629 8.79a.75.75 0 001.449.39z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );

  const classificationMap = new Map(
    (data?.images ?? []).map((img) => [img.image_id, img])
  );

  // When classification data exists, the JSON is the source of truth for which
  // images to show. Disk imageIds are only used as a fallback before classification.
  const allImageIds = data
    ? data.images.map((img) => img.image_id)
    : [...imageIds].sort();

  return (
    <div>
      <div className="flex items-center gap-2 bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
        <span>Images</span>
        {error && (
          <span className="text-xs font-normal text-red-200">{error}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {isDirty && (
            <>
              <button
                type="button"
                onClick={discardEdits}
                disabled={saving}
                className="cursor-pointer rounded bg-amber-500 px-2 py-0.5 text-xs font-medium hover:bg-amber-400 disabled:opacity-50 transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={saveChanges}
                disabled={saving}
                className="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-70 transition-colors"
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
          {data && versions.length > 0 && (
            <div ref={versionDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setVersionDropdownOpen(!versionDropdownOpen)}
                className="cursor-pointer rounded bg-amber-500 px-1.5 py-0.5 text-xs font-medium hover:bg-amber-400 transition-colors"
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
          )}
          {rerunButton}
        </div>
      </div>
      <div className="p-4">
        {allImageIds.length > 0 ? (
          <div className="grid auto-rows-min grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {allImageIds.map((imageId) => {
              const entry = classificationMap.get(imageId);
              const isPruned = entry?.is_pruned ?? false;
              const isPendingCrop = pendingCrops.has(imageId);
              const sourceEntry = entry?.source_image_id
                ? classificationMap.get(entry.source_image_id)
                : null;
              const cropOverlay =
                isPendingCrop && entry?.source_region && sourceEntry
                  ? {
                      left: `${(entry.source_region.x / sourceEntry.width) * 100}%`,
                      top: `${(entry.source_region.y / sourceEntry.height) * 100}%`,
                      width: `${(entry.source_region.width / sourceEntry.width) * 100}%`,
                      height: `${(entry.source_region.height / sourceEntry.height) * 100}%`,
                    }
                  : null;
              return (
                  <div key={imageId} className="self-start">
                    <div className="group/img relative">
                    <img
                      src={`/api/books/${label}/pages/${pageId}/images/${isPendingCrop ? (entry?.source_image_id ?? imageId) : imageId}?v=${version}`}
                      alt={imageId}
                      className={`w-full rounded-t border border-border ${isPruned ? "opacity-50" : ""}`}
                    />
                    {cropOverlay && (
                      <div
                        className="absolute border-2 border-amber-500 rounded-sm pointer-events-none"
                        style={cropOverlay}
                      />
                    )}
                    {entry && (
                      <>
                        <button
                          type="button"
                          onClick={() => togglePruned(imageId)}
                          title={isPruned ? "Unprune image" : "Prune image"}
                          className={`absolute top-1.5 right-1.5 rounded-md p-1 transition-colors bg-red-500/80 text-white hover:bg-red-500 ${
                            isPruned
                              ? ""
                              : "invisible group-hover/img:visible"
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
                        <button
                          type="button"
                          onClick={() => setCropImageId(imageId)}
                          title="Crop image"
                          className="absolute top-1.5 left-1.5 rounded-md p-1 transition-all bg-amber-500/90 text-white opacity-0 group-hover/img:opacity-100 hover:bg-amber-400"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-5 w-5"
                          >
                            <path d="M4.75 2a.75.75 0 00-.75.75v3.5H2.75a.75.75 0 000 1.5H4v7.5a1.75 1.75 0 001.75 1.75h7.5v1.25a.75.75 0 001.5 0v-1.25h1.5a.75.75 0 000-1.5H14.75V7.75A1.75 1.75 0 0013 6H5.5V2.75A.75.75 0 004.75 2zM5.5 7.5H13a.25.25 0 01.25.25V15.25H5.75a.25.25 0 01-.25-.25V7.5z" />
                          </svg>
                        </button>
                      </>
                    )}
                    </div>
                    <div className="flex items-center justify-between rounded-b border border-t-0 border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                      <span>
                        {entry ? <>{entry.width}&times;{entry.height}</> : null}
                      </span>
                      <span>{imageId}</span>
                    </div>
                  </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm italic text-muted">
            No images extracted from this page.
          </p>
        )}
      </div>
      {cropImageId && (
        <ImageCropDialog
          src={`/api/books/${label}/pages/${pageId}/images/${cropImageId}?v=${version}`}
          alt={cropImageId}
          onCrop={(c) => updateCrop(cropImageId, c)}
          onClose={() => setCropImageId(null)}
        />
      )}
    </div>
  );
}
