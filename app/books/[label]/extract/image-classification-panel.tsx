"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ImageEntry,
  PageImageClassification,
} from "@/lib/pipeline/image-classification/image-classification-schema";
import { ImageCropDialog } from "./image-crop-dialog";
import { NodeHeader, type VersionApi } from "../node-header";
import { usePipelineBusy, usePanelJobBusy, usePanelJobError, useRerun } from "../use-pipeline-refresh";

interface ImageClassificationPanelProps {
  label: string;
  pageId: string;
  pageIndex: number;
  imageIds: string[];
  initialClassification: PageImageClassification | null;
  initialVersion: number;
  availableVersions: number[];
  initialImageHashes: Record<string, string>;
}

export function ImageClassificationPanel({
  label,
  pageId,
  pageIndex,
  imageIds,
  initialClassification,
  initialVersion,
  availableVersions: initialAvailableVersions,
  initialImageHashes,
}: ImageClassificationPanelProps) {
  const [data, setData] = useState<PageImageClassification | null>(
    initialClassification
  );
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [imageHashes, setImageHashes] = useState<Record<string, string>>(initialImageHashes);
  const currentVersionRef = useRef(initialVersion);
  const [isDirty, setIsDirty] = useState(false);
  const [cropImageId, setCropImageId] = useState<string | null>(null);
  const [pendingCrops, setPendingCrops] = useState<Set<string>>(new Set());

  const pipelineBusy = usePipelineBusy(pageId, "image-classification");
  const panelJobBusy = usePanelJobBusy(pageId, "image-classification");
  const { error: jobError } = usePanelJobError(pageId, "image-classification");
  const apiBase = `/api/books/${label}/pages/${pageId}/image-classification`;
  const { rerun: handleRerun, error: rerunError } = useRerun(apiBase);
  const busy = pipelineBusy || panelJobBusy;
  const error = jobError || rerunError;

  // Sync from server props when the pipeline produces new data
  useEffect(() => {
    if (isDirty) return;
    setData(initialClassification);
    setVersions(initialAvailableVersions);
    setImageHashes(initialImageHashes);
    currentVersionRef.current = initialVersion;
  }, [initialClassification, initialVersion, initialAvailableVersions, initialImageHashes]);

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

    // Compute cropId outside the updater so React StrictMode double-invocation
    // doesn't produce a different ID than what setPendingCrops receives.
    const cropId = `${pageId}_crop_${Date.now()}`;
    setData((prev) => {
      const next: PageImageClassification = JSON.parse(
        JSON.stringify(prev ?? { images: [] })
      );

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
      const json = await versionApi.loadVersion(currentVersionRef.current);
      const resp = json as { data: PageImageClassification; imageHashes?: Record<string, string> };
      setData(resp.data);
      if (resp.imageHashes) setImageHashes(resp.imageHashes);
    } catch {
      // ignore
    }
    setPendingCrops(new Set());
    setIsDirty(false);
  }

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
      <NodeHeader
        title="Images"
        color="amber"
        initialVersion={initialVersion}
        initialVersions={versions}
        versionApi={versionApi}
        onVersionLoaded={(v, raw) => {
          const resp = raw as { data: PageImageClassification; imageHashes?: Record<string, string> };
          setData(resp.data);
          currentVersionRef.current = v;
          if (resp.imageHashes) setImageHashes(resp.imageHashes);
        }}
        onVersionSaved={(newVersion, newVersions, raw) => {
          const resp = raw as { data: PageImageClassification; imageHashes?: Record<string, string> };
          setData(resp.data);
          currentVersionRef.current = newVersion;
          setVersions(newVersions);
          if (resp.imageHashes) setImageHashes(resp.imageHashes);
          setIsDirty(false);
          setPendingCrops(new Set());
        }}
        rerunLoading={busy}
        rerunDisabled={isDirty}
        onRerun={handleRerun}
        rerunTitle={data ? "Rerun image classification" : "Run image classification"}
        isDirty={isDirty}
        onDirtyDiscard={discardEdits}
        error={error}
      />
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
              const displayId = isPendingCrop ? (entry?.source_image_id ?? imageId) : imageId;
              const hash = imageHashes[displayId] ?? "";
              return (
                  <div key={imageId} className="self-start">
                    <div className="group/img relative">
                    <img
                      src={`/api/books/${label}/pages/${pageId}/images/${displayId}?h=${hash}`}
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
          src={`/api/books/${label}/pages/${pageId}/images/${cropImageId}?h=${imageHashes[cropImageId] ?? ""}`}
          alt={cropImageId}
          onCrop={(c) => updateCrop(cropImageId, c)}
          onClose={() => setCropImageId(null)}
        />
      )}
    </div>
  );
}
