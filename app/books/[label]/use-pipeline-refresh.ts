"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
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

class PipelineStore {
  /** pageId → current normalized phase */
  private phases = new Map<string, Phase>();
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
        if (job.type !== "page-pipeline") return;

        const pageId = job.params?.pageId as string | undefined;
        if (!pageId) return;

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
