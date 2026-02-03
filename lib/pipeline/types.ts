import path from "node:path";

export interface BookPaths {
  bookDir: string;
  imagesDir: string;
  metadataDir: string;
  metadataFile: string;
  textClassificationDir: string;
  pageSectioningDir: string;
  webRenderingDir: string;
}

export function resolveBookPaths(
  label: string,
  outputRoot = "books"
): BookPaths {
  const bookDir = path.resolve(outputRoot, label);
  const imagesDir = path.join(bookDir, "images");
  const metadataDir = path.join(bookDir, "metadata");
  const metadataFile = path.join(metadataDir, "metadata.json");
  const textClassificationDir = path.join(bookDir, "text-classification");
  const pageSectioningDir = path.join(bookDir, "page-sectioning");
  const webRenderingDir = path.join(bookDir, "web-rendering");
  return {
    bookDir,
    imagesDir,
    metadataDir,
    metadataFile,
    textClassificationDir,
    pageSectioningDir,
    webRenderingDir,
  };
}
