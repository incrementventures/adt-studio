"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import React from "react";

/**
 * Wraps the storyboard page with a single SSE connection to the job queue.
 *
 * - Calls a debounced router.refresh() when pipeline steps complete so panels
 *   pick up fresh server-rendered props.
 * - Tracks per-page pipeline progress so panels can show spinners when their
 *   step is queued or running in the background.
 */

// ---------------------------------------------------------------------------
// Progress phases — ordered so we can compare ordinally
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  "queued",
  "Classifying images",
  "Classifying text",
  "Sectioning page",
  "Rendering web pages",
  "rendering",        // any "Rendering section N/M"
  "completed",
] as const;

type Phase = (typeof PHASE_ORDER)[number];

function normalizePhase(progress: string | undefined, status: string): Phase {
  if (status === "queued") return "queued";
  if (status === "completed" || status === "failed") return "completed";
  if (!progress) return "queued";
  if (progress.startsWith("Rendering section")) return "rendering";
  const found = PHASE_ORDER.find((p) => p === progress);
  return found ?? "queued";
}

function phaseIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

// ---------------------------------------------------------------------------
// Which phases mean "this panel's step hasn't finished yet"
// ---------------------------------------------------------------------------

/** Returns true if the pipeline is at or before the given panel's active phase */
export function isPipelineBusy(
  phase: Phase | null,
  panel: "image-classification" | "text-classification" | "sections" | "web-rendering"
): boolean {
  if (!phase || phase === "completed") return false;
  const idx = phaseIndex(phase);
  switch (panel) {
    // Image classification is busy during "Classifying images"
    case "image-classification":
      return idx <= phaseIndex("Classifying images");
    // Text classification is busy from queued through "Classifying text"
    case "text-classification":
      return idx <= phaseIndex("Classifying text");
    // Sections is busy during "Sectioning page"
    case "sections":
      return idx === phaseIndex("Sectioning page");
    // Web rendering is busy from "Rendering web pages" through rendering
    case "web-rendering":
      return idx >= phaseIndex("Rendering web pages") && idx < phaseIndex("completed");
  }
}

// ---------------------------------------------------------------------------
// Store — mutable snapshot map that drives useSyncExternalStore
// ---------------------------------------------------------------------------

type Listener = () => void;

export type PanelJobType =
  | "image-classification"
  | "text-classification"
  | "page-sectioning";

class PipelineStore {
  /** pageId → current normalized phase */
  private phases = new Map<string, Phase>();
  /** "pageId:sectionIndex" → job status for web-rendering-section jobs */
  private sectionJobs = new Map<string, "running" | "queued">();
  /** "pageId:jobType" → "running" | "queued" for individual panel jobs */
  private panelJobs = new Map<string, "running" | "queued">();
  /** "pageId:jobType" → error message (set on failure, cleared on next run) */
  private panelErrors = new Map<string, string>();
  private listeners = new Set<Listener>();

  getPhase(pageId: string): Phase | null {
    return this.phases.get(pageId) ?? null;
  }

  setPhase(pageId: string, phase: Phase) {
    if (this.phases.get(pageId) === phase) return;
    if (phase === "completed") {
      this.phases.delete(pageId);
    } else {
      this.phases.set(pageId, phase);
    }
    this.emit();
  }

  isSectionBusy(pageId: string, sectionIndex: number): boolean {
    return this.sectionJobs.has(`${pageId}:${sectionIndex}`);
  }

  isAnySectionBusy(pageId: string): boolean {
    for (const key of this.sectionJobs.keys()) {
      if (key.startsWith(`${pageId}:`)) return true;
    }
    return false;
  }

  setSectionJob(pageId: string, sectionIndex: number, status: string) {
    const key = `${pageId}:${sectionIndex}`;
    if (status === "completed" || status === "failed") {
      if (!this.sectionJobs.has(key)) return;
      this.sectionJobs.delete(key);
    } else {
      const val = status === "running" ? "running" : "queued";
      if (this.sectionJobs.get(key) === val) return;
      this.sectionJobs.set(key, val);
    }
    this.emit();
  }

  // --- Panel job tracking ---

  isPanelJobBusy(pageId: string, jobType: PanelJobType): boolean {
    return this.panelJobs.has(`${pageId}:${jobType}`);
  }

  getPanelJobError(pageId: string, jobType: PanelJobType): string | null {
    return this.panelErrors.get(`${pageId}:${jobType}`) ?? null;
  }

  setPanelJob(pageId: string, jobType: PanelJobType, status: string, error?: string) {
    const key = `${pageId}:${jobType}`;
    if (status === "completed") {
      const had = this.panelJobs.has(key);
      this.panelJobs.delete(key);
      this.panelErrors.delete(key);
      if (!had) return;
    } else if (status === "failed") {
      this.panelJobs.delete(key);
      if (error) this.panelErrors.set(key, error);
    } else {
      const val = status === "running" ? "running" as const : "queued" as const;
      if (this.panelJobs.get(key) === val) return;
      this.panelJobs.set(key, val);
      this.panelErrors.delete(key);
    }
    this.emit();
  }

  clearPanelError(pageId: string, jobType: PanelJobType) {
    const key = `${pageId}:${jobType}`;
    if (!this.panelErrors.has(key)) return;
    this.panelErrors.delete(key);
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PipelineCtx = createContext<PipelineStore | null>(null);

const REFRESH_PHASES = new Set([
  "Sectioning page",     // text classification just finished
  "Rendering web pages", // page sectioning just finished
]);

const DEBOUNCE_MS = 1000;

export function PipelineSSEProvider({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const storeRef = useRef(new PipelineStore());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      router.refresh();
    }, DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    const store = storeRef.current;
    const es = new EventSource("/api/queue");

    es.addEventListener("job", (e) => {
      try {
        const job = JSON.parse(e.data);
        if (job.label !== label) return;

        const pageId = job.params?.pageId as string | undefined;
        if (!pageId) return;

        // Track per-section web-rendering jobs
        if (job.type === "web-rendering-section") {
          const sectionIndex = job.params?.sectionIndex as number | undefined;
          if (sectionIndex != null) {
            store.setSectionJob(pageId, sectionIndex, job.status);
            if (job.status === "completed" || job.status === "failed") scheduleRefresh();
          }
          return;
        }

        // Track individual panel jobs (standalone reruns)
        const PANEL_JOB_TYPES = new Set<PanelJobType>([
          "image-classification",
          "text-classification",
          "page-sectioning",
        ]);
        if (PANEL_JOB_TYPES.has(job.type as PanelJobType)) {
          store.setPanelJob(pageId, job.type as PanelJobType, job.status, job.error);
          if (job.status === "completed" || job.status === "failed") scheduleRefresh();
          return;
        }

        if (job.type !== "page-pipeline") return;

        const phase = normalizePhase(job.progress, job.status);
        store.setPhase(pageId, phase);

        if (job.status === "completed" || job.status === "failed") {
          scheduleRefresh();
          return;
        }

        if (job.progress && REFRESH_PHASES.has(job.progress)) {
          scheduleRefresh();
        }
      } catch {
        /* skip */
      }
    });

    return () => {
      es.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [label, scheduleRefresh]);

  return React.createElement(
    PipelineCtx.Provider,
    { value: storeRef.current },
    children
  );
}

// ---------------------------------------------------------------------------
// Hook — returns true if the pipeline is busy for this panel + pageId
// ---------------------------------------------------------------------------

export function usePipelineBusy(
  pageId: string,
  panel: "image-classification" | "text-classification" | "sections" | "web-rendering"
): boolean {
  const store = useContext(PipelineCtx);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {};
      return store.subscribe(onStoreChange);
    },
    [store]
  );

  const getSnapshot = useCallback(() => {
    if (!store) return false;
    return isPipelineBusy(store.getPhase(pageId), panel);
  }, [store, pageId, panel]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// ---------------------------------------------------------------------------
// Hook — returns true if a web-rendering-section job is active for this section
// ---------------------------------------------------------------------------

export function useSectionBusy(
  pageId: string,
  sectionIndex: number
): boolean {
  const store = useContext(PipelineCtx);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {};
      return store.subscribe(onStoreChange);
    },
    [store]
  );

  const getSnapshot = useCallback(() => {
    if (!store) return false;
    return store.isSectionBusy(pageId, sectionIndex);
  }, [store, pageId, sectionIndex]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// ---------------------------------------------------------------------------
// Hook — returns true if any web-rendering-section job is active for this page
// ---------------------------------------------------------------------------

export function useAnySectionBusy(pageId: string): boolean {
  const store = useContext(PipelineCtx);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {};
      return store.subscribe(onStoreChange);
    },
    [store]
  );

  const getSnapshot = useCallback(() => {
    if (!store) return false;
    return store.isAnySectionBusy(pageId);
  }, [store, pageId]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// ---------------------------------------------------------------------------
// Hook — returns true if a standalone panel job is active for this page+type
// ---------------------------------------------------------------------------

export function usePanelJobBusy(
  pageId: string,
  jobType: PanelJobType
): boolean {
  const store = useContext(PipelineCtx);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {};
      return store.subscribe(onStoreChange);
    },
    [store]
  );

  const getSnapshot = useCallback(() => {
    if (!store) return false;
    return store.isPanelJobBusy(pageId, jobType);
  }, [store, pageId, jobType]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// ---------------------------------------------------------------------------
// Hook — returns the error from the last failed panel job (or null)
// ---------------------------------------------------------------------------

export function usePanelJobError(
  pageId: string,
  jobType: PanelJobType
): { error: string | null; clearError: () => void } {
  const store = useContext(PipelineCtx);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {};
      return store.subscribe(onStoreChange);
    },
    [store]
  );

  const getSnapshot = useCallback(() => {
    if (!store) return null;
    return store.getPanelJobError(pageId, jobType);
  }, [store, pageId, jobType]);

  const error = useSyncExternalStore(subscribe, getSnapshot, () => null);

  const clearError = useCallback(() => {
    store?.clearPanelError(pageId, jobType);
  }, [store, pageId, jobType]);

  return { error, clearError };
}

// ---------------------------------------------------------------------------
// Hook — POST-and-forget rerun pattern shared by all panels
// ---------------------------------------------------------------------------

export function useRerun(url: string): {
  rerun: () => Promise<void>;
  error: string | null;
  clearError: () => void;
} {
  const [error, setError] = useState<string | null>(null);

  const rerun = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [url]);

  const clearError = useCallback(() => setError(null), []);

  return { rerun, error, clearError };
}
