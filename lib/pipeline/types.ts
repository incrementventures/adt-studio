import path from "node:path";

export interface BookPaths {
  bookDir: string;
  extractDir: string;
  pagesDir: string;
  metadataDir: string;
  metadataFile: string;
  textExtractionDir: string;
  pageSectioningDir: string;
}

export function resolveBookPaths(
  label: string,
  outputRoot = "books"
): BookPaths {
  const bookDir = path.resolve(outputRoot, label);
  const extractDir = path.join(bookDir, "extract");
  const pagesDir = path.join(extractDir, "pages");
  const metadataDir = path.join(bookDir, "metadata");
  const metadataFile = path.join(metadataDir, "metadata.json");
  const textExtractionDir = path.join(bookDir, "text-extraction");
  const pageSectioningDir = path.join(bookDir, "page-sectioning");
  return {
    bookDir,
    extractDir,
    pagesDir,
    metadataDir,
    metadataFile,
    textExtractionDir,
    pageSectioningDir,
  };
}

export type { LLMProvider } from "./node";
