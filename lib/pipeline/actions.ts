/**
 * Pipeline Actions
 *
 * Thin wrapper functions that create runners and call pure pipeline steps.
 * These maintain backwards compatibility with existing API routes and queue.
 */

import {
  createPageRunner,
  runPagePipeline as runPagePipelineImpl,
  runImageClassification as runImageClassificationImpl,
  runTextClassification as runTextClassificationImpl,
  runPageSectioning as runPageSectioningImpl,
  runWebRendering as runWebRenderingImpl,
  runWebRenderingSection as runWebRenderingSectionImpl,
  runWebEdit as runWebEditImpl,
  nullProgress,
  createCallbackProgress,
} from "./runner";
import type { SectionRendering } from "./core/schemas";
import type { Annotation } from "./steps/web-rendering";

// Re-export types that API routes need
export type { Annotation } from "./steps/web-rendering";
export type { SectionRendering } from "./core/schemas";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function createRunner(label: string, options?: { skipCache?: boolean; onProgress?: (msg: string) => void }) {
  return createPageRunner({
    label,
    progress: options?.onProgress ? createCallbackProgress(options.onProgress) : nullProgress,
    skipCache: options?.skipCache,
  });
}

// ---------------------------------------------------------------------------
// Web rendering — render all sections for one page
// ---------------------------------------------------------------------------

export interface WebRenderingResult {
  sections: SectionRendering[];
}

export async function runWebRendering(
  label: string,
  pageId: string,
  onProgress?: (message: string) => void,
  options?: { skipCache?: boolean }
): Promise<WebRenderingResult> {
  const runner = createRunner(label, { skipCache: options?.skipCache, onProgress });
  const result = await runWebRenderingImpl(pageId, runner, onProgress);
  return { sections: result.sections };
}

// ---------------------------------------------------------------------------
// Web rendering — render a single section for one page
// ---------------------------------------------------------------------------

export interface WebEditResult {
  section: SectionRendering;
  version: number;
  versions: number[];
}

export async function runWebRenderingSection(
  label: string,
  pageId: string,
  sectionIndex: number,
  onProgress?: (message: string) => void,
  options?: { skipCache?: boolean }
): Promise<WebEditResult> {
  const runner = createRunner(label, { skipCache: options?.skipCache, onProgress });
  const result = await runWebRenderingSectionImpl(pageId, sectionIndex, runner);
  return {
    section: result,
    version: 1,
    versions: [1],
  };
}

// ---------------------------------------------------------------------------
// Web edit — annotation-based LLM edit of a single section
// ---------------------------------------------------------------------------

export interface WebEditParams {
  pageId: string;
  sectionIndex: number;
  annotationImageBase64: string;
  annotations: Annotation[];
  currentHtml: string;
}

export async function runWebEdit(
  label: string,
  params: WebEditParams
): Promise<WebEditResult> {
  const { pageId, sectionIndex, annotationImageBase64, annotations, currentHtml } = params;
  const runner = createRunner(label);
  const result = await runWebEditImpl(
    pageId,
    sectionIndex,
    annotationImageBase64,
    annotations,
    currentHtml,
    runner
  );
  return {
    section: result,
    version: 1,
    versions: [1],
  };
}

// ---------------------------------------------------------------------------
// Text classification — classify a single page
// ---------------------------------------------------------------------------

export interface TextClassificationResult {
  version: number;
  [key: string]: unknown;
}

export async function runTextClassification(
  label: string,
  pageId: string,
  options?: { skipCache?: boolean }
): Promise<TextClassificationResult> {
  const runner = createRunner(label, { skipCache: options?.skipCache });
  const result = await runTextClassificationImpl(pageId, runner);
  return { version: result.version };
}

// ---------------------------------------------------------------------------
// Page sectioning — section a single page
// ---------------------------------------------------------------------------

export async function runPageSectioning(
  label: string,
  pageId: string,
  options?: { skipCache?: boolean }
): Promise<{ version: number }> {
  const runner = createRunner(label, { skipCache: options?.skipCache });
  return runPageSectioningImpl(pageId, runner);
}

// ---------------------------------------------------------------------------
// Image classification — rule-based size filtering for one page (no LLM)
// ---------------------------------------------------------------------------

export async function runImageClassification(
  label: string,
  pageId: string
): Promise<{ version: number }> {
  const runner = createRunner(label);
  return runImageClassificationImpl(pageId, runner);
}

// ---------------------------------------------------------------------------
// Page pipeline — full sequential processing of one page
// ---------------------------------------------------------------------------

export async function runPagePipeline(
  label: string,
  pageId: string,
  onProgress?: (message: string) => void
): Promise<void> {
  const runner = createRunner(label, { onProgress });
  await runPagePipelineImpl(pageId, runner);
}
