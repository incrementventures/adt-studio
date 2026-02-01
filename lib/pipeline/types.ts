import path from "node:path";

export interface BookPaths {
  bookDir: string;
  extractDir: string;
  pagesDir: string;
  metadataDir: string;
  metadataFile: string;
  stubMetadataFile: string;
  textClassificationDir: string;
  imageClassificationDir: string;
  pageSectioningDir: string;
  webRenderingDir: string;
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
  const stubMetadataFile = path.join(extractDir, "pdf-metadata.json");
  const textClassificationDir = path.join(bookDir, "text-classification");
  const imageClassificationDir = path.join(bookDir, "image-classification");
  const pageSectioningDir = path.join(bookDir, "page-sectioning");
  const webRenderingDir = path.join(bookDir, "web-rendering");
  return {
    bookDir,
    extractDir,
    pagesDir,
    metadataDir,
    metadataFile,
    stubMetadataFile,
    textClassificationDir,
    imageClassificationDir,
    pageSectioningDir,
    webRenderingDir,
  };
}

export type { LLMProvider } from "./node";
