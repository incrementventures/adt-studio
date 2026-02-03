/**
 * Runner layer types.
 *
 * These interfaces define the contracts between the pure pipeline steps
 * and the infrastructure (storage, progress emission, etc.).
 */

import type { Page, PageImage, StepConfig, LLMModel } from "../core/types";
import type {
  ImageClassificationOutput,
  TextClassificationOutput,
  PageSectioningOutput,
  SectionRendering,
} from "../core/schemas";
import type {
  ExtractedPage,
  ExtractedImage,
  PdfMetadata,
  BookMetadata,
} from "../steps";

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Abstract storage interface for pipeline data.
 *
 * Implementations can use SQLite, filesystem, in-memory, etc.
 * The pipeline steps don't know or care about the underlying storage.
 */
export interface Storage {
  // -------------------------------------------------------------------------
  // Book-level operations (extraction & metadata)
  // -------------------------------------------------------------------------

  /** List all page IDs in the book */
  listPageIds(): Promise<string[]>;

  /** Get the first N pages (for metadata extraction) */
  getFirstPages(count: number): Promise<Page[]>;

  /** Get book metadata */
  getBookMetadata(): Promise<BookMetadata | null>;

  /** Save book metadata */
  putBookMetadata(data: BookMetadata, source: "stub" | "llm"): Promise<void>;

  /** Save PDF metadata */
  putPdfMetadata(data: PdfMetadata): Promise<void>;

  /** Save an extracted page (text + page image + embedded images) */
  putExtractedPage(page: ExtractedPage): Promise<void>;

  /** Write an image file to disk and record in DB */
  putImage(image: ExtractedImage, source: "page" | "extract" | "crop"): Promise<void>;

  // -------------------------------------------------------------------------
  // Page-level read operations
  // -------------------------------------------------------------------------

  getPage(pageId: string): Promise<Page | null>;
  getPageImages(pageId: string): Promise<PageImage[]>;
  getBookLanguage(): Promise<string>;

  getImageClassification(
    pageId: string
  ): Promise<{ data: ImageClassificationOutput; version: number } | null>;

  getTextClassification(
    pageId: string
  ): Promise<{ data: TextClassificationOutput; version: number } | null>;

  getPageSectioning(
    pageId: string
  ): Promise<{ data: PageSectioningOutput; version: number } | null>;

  getSectionRendering(
    sectionId: string
  ): Promise<{ data: SectionRendering; version: number } | null>;

  // -------------------------------------------------------------------------
  // Page-level write operations
  // -------------------------------------------------------------------------

  putImageClassification(
    pageId: string,
    data: ImageClassificationOutput
  ): Promise<{ version: number }>;

  putTextClassification(
    pageId: string,
    data: TextClassificationOutput
  ): Promise<{ version: number }>;

  putPageSectioning(
    pageId: string,
    data: PageSectioningOutput,
    textClassificationVersion: number,
    imageClassificationVersion: number
  ): Promise<{ version: number }>;

  putSectionRendering(
    sectionId: string,
    data: SectionRendering | null
  ): Promise<{ version: number }>;
}

// ============================================================================
// Progress Interface
// ============================================================================

export type BookStepName = "extract" | "metadata" | "pages";

export type PageStepName =
  | "image-classification"
  | "text-classification"
  | "page-sectioning"
  | "web-rendering";

export type StepName = BookStepName | PageStepName;

export type ProgressEvent =
  // Book-level events
  | { type: "book-step-start"; step: BookStepName }
  | { type: "book-step-progress"; step: BookStepName; message: string; page?: number; totalPages?: number }
  | { type: "book-step-complete"; step: BookStepName }
  | { type: "book-step-error"; step: BookStepName; error: string }
  // Page-level events
  | { type: "step-start"; step: PageStepName; pageId: string }
  | { type: "step-progress"; step: PageStepName; pageId: string; message: string }
  | { type: "step-complete"; step: PageStepName; pageId: string; version: number }
  | { type: "step-error"; step: PageStepName; pageId: string; error: string };

/**
 * Progress emitter interface.
 *
 * Implementations can log to console, send SSE events, update a job queue, etc.
 */
export interface Progress {
  emit(event: ProgressEvent): void;
}

/**
 * No-op progress emitter for when progress tracking isn't needed.
 */
export const nullProgress: Progress = {
  emit: () => {},
};

/**
 * Console-based progress emitter for CLI usage.
 */
export function createConsoleProgress(): Progress {
  return {
    emit(event) {
      switch (event.type) {
        // Book-level events
        case "book-step-start":
          console.log(`Starting ${formatStepName(event.step)}...`);
          break;
        case "book-step-progress":
          if (event.page !== undefined && event.totalPages !== undefined) {
            console.log(`${formatStepName(event.step)}: ${event.message} (${event.page}/${event.totalPages})`);
          } else {
            console.log(`${formatStepName(event.step)}: ${event.message}`);
          }
          break;
        case "book-step-complete":
          console.log(`Completed ${formatStepName(event.step)}`);
          break;
        case "book-step-error":
          console.error(`Error in ${formatStepName(event.step)}: ${event.error}`);
          break;
        // Page-level events
        case "step-start":
          console.log(`[${event.pageId}] Starting ${formatStepName(event.step)}...`);
          break;
        case "step-progress":
          console.log(`[${event.pageId}] ${formatStepName(event.step)}: ${event.message}`);
          break;
        case "step-complete":
          console.log(
            `[${event.pageId}] Completed ${formatStepName(event.step)} (v${event.version})`
          );
          break;
        case "step-error":
          console.error(`[${event.pageId}] Error in ${formatStepName(event.step)}: ${event.error}`);
          break;
      }
    },
  };
}

/**
 * Callback-based progress emitter for job queue integration.
 */
export function createCallbackProgress(
  callback: (message: string) => void
): Progress {
  return {
    emit(event) {
      switch (event.type) {
        // Book-level events
        case "book-step-start":
          callback(`Starting ${formatStepName(event.step)}`);
          break;
        case "book-step-progress":
          if (event.page !== undefined && event.totalPages !== undefined) {
            callback(`${event.message} (${event.page}/${event.totalPages})`);
          } else {
            callback(event.message);
          }
          break;
        case "book-step-complete":
          callback(`Completed ${formatStepName(event.step)}`);
          break;
        case "book-step-error":
          callback(`Error: ${event.error}`);
          break;
        // Page-level events
        case "step-start":
          callback(`Starting ${formatStepName(event.step)}`);
          break;
        case "step-progress":
          callback(event.message);
          break;
        case "step-complete":
          callback(`Completed ${formatStepName(event.step)}`);
          break;
        case "step-error":
          callback(`Error: ${event.error}`);
          break;
      }
    },
  };
}

function formatStepName(step: StepName): string {
  switch (step) {
    case "extract":
      return "extraction";
    case "metadata":
      return "metadata extraction";
    case "pages":
      return "page processing";
    case "image-classification":
      return "image classification";
    case "text-classification":
      return "text classification";
    case "page-sectioning":
      return "page sectioning";
    case "web-rendering":
      return "web rendering";
  }
}

// ============================================================================
// Runner Configuration
// ============================================================================

/**
 * Configuration for the page runner.
 */
export interface PageRunnerConfig {
  storage: Storage;
  progress: Progress;
  config: StepConfig;
  model: LLMModel;
  prompts: PromptConfig;
}

/**
 * Prompt template names for each step.
 */
export interface PromptConfig {
  metadata: string;
  textClassification: string;
  pageSectioning: string;
  webRendering: string;
  sectionEdit?: string;
}

/**
 * Options for running the pipeline.
 */
export interface RunOptions {
  /** Only run these steps (default: all) */
  steps?: StepName[];
  /** Skip LLM cache */
  skipCache?: boolean;
}
