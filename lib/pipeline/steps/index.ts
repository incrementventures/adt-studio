/**
 * Pure pipeline step functions.
 *
 * Each step is a pure function that:
 * - Takes typed inputs
 * - Returns typed outputs
 * - Has no side effects (no file I/O, no database access)
 * - Receives LLM model as a parameter (if needed)
 *
 * Exception: extractPdf reads from a buffer but returns data for the caller
 * to persist - it doesn't write to storage itself.
 */

// Book-level steps
export {
  extractPdf,
  type ExtractInput,
  type ExtractedPage,
  type ExtractedImage,
  type ExtractResult,
  type ExtractProgress,
  type PdfMetadata,
} from "./extract";

export {
  extractMetadata,
  type ExtractMetadataInput,
  type BookMetadata,
} from "./metadata";

// Page-level steps
export {
  classifyImages,
  type ClassifyImagesInput,
} from "./image-classification";

export {
  classifyText,
  buildGroupSummaries,
  type ClassifyTextInput,
} from "./text-classification";

export {
  sectionPage,
  type SectionPageInput,
} from "./page-sectioning";

export {
  renderPage,
  renderSection,
  editSection,
  type RenderPageInput,
  type RenderSectionInput,
  type EditSectionInput,
  type TextInput,
  type ImageInput,
  type Annotation,
  type SectionEditOutput,
} from "./web-rendering";
