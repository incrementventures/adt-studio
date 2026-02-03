/**
 * Pipeline Runner Module
 *
 * Provides the orchestration layer for running pure pipeline steps
 * with storage and progress tracking.
 */

export {
  type Storage,
  type Progress,
  type PageRunnerConfig,
  type PromptConfig,
  type RunOptions,
  type StepName,
  type BookStepName,
  type PageStepName,
  type ProgressEvent,
  nullProgress,
  createConsoleProgress,
  createCallbackProgress,
} from "./types";

// Book-level runners
export {
  runExtract,
  runMetadataExtraction,
  runBookPipeline,
  type ExtractOptions,
  type BookPipelineOptions,
} from "./book-runner";

// Page-level runners
export {
  runPagePipeline,
  runImageClassification,
  runTextClassification,
  runPageSectioning,
  runWebRendering,
  runWebRenderingSection,
  runWebEdit,
} from "./page-runner";

export { createBookStorage } from "./storage-adapter";

// Re-export factory for convenient setup
export { createPageRunner } from "./factory";

// Re-export types from steps that external code may need
export type { PdfMetadata } from "../steps/extract";
