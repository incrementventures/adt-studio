/**
 * PDF Extraction Step
 *
 * Pipeline step that extracts pages, text, and images from a PDF file.
 * Delegates to the PDF extraction library.
 */

export {
  extractPdf,
  type ExtractInput,
  type ExtractedPage,
  type ExtractedImage,
  type PdfMetadata,
  type ExtractResult,
  type ExtractProgress,
} from "../../pdf/extract";
