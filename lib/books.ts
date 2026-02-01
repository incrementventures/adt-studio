import fs from "node:fs";
import path from "node:path";
import { resolveBookPaths } from "./pipeline/types";
import { bookMetadataSchema, type BookMetadata } from "./pipeline/metadata/metadata-schema";
import type { PageSectioning } from "./pipeline/page-sectioning/page-sectioning-schema";
import type { PageImageClassification } from "./pipeline/image-classification/image-classification-schema";
import type { SectionRendering, WebRendering } from "./pipeline/web-rendering/web-rendering-schema";

interface TextEntry {
  text_type: string;
  text: string;
  is_pruned: boolean;
}

interface TextGroup {
  group_id?: string;
  group_type: string;
  texts: TextEntry[];
}

export interface PageTextClassification {
  reasoning: string;
  groups: TextGroup[];
}

export function getBooksRoot(): string {
  return path.resolve(process.env.BOOKS_ROOT ?? "books");
}

export interface BookSummary {
  label: string;
  metadata: BookMetadata;
  pageCount: number;
}

export function listBooks(): BookSummary[] {
  const root = getBooksRoot();
  if (!fs.existsSync(root)) return [];

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const books: BookSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const label = entry.name;
    const paths = resolveBookPaths(label, root);
    if (!fs.existsSync(paths.metadataFile)) continue;

    const metadata = getBookMetadata(label);
    if (!metadata) continue;

    const pageCount = countPages(paths.pagesDir);
    books.push({ label, metadata, pageCount });
  }

  return books.sort((a, b) => a.label.localeCompare(b.label));
}

export function getBookMetadata(label: string): BookMetadata | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  if (!fs.existsSync(paths.metadataFile)) return null;

  const raw = JSON.parse(fs.readFileSync(paths.metadataFile, "utf-8"));
  const result = bookMetadataSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export interface PageSummary {
  pageId: string;
  hasImages: boolean;
  imageIds: string[];
  rawText: string;
}

export function listPages(label: string): PageSummary[] {
  const paths = resolveBookPaths(label, getBooksRoot());
  if (!fs.existsSync(paths.pagesDir)) return [];

  return fs
    .readdirSync(paths.pagesDir)
    .filter((d) => /^pg\d{3}$/.test(d))
    .sort()
    .map((pageId) => buildPageSummary(paths.pagesDir, pageId));
}

export function getPage(label: string, pageId: string): PageSummary | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const pageDir = path.join(paths.pagesDir, pageId);
  if (!fs.existsSync(pageDir)) return null;
  return buildPageSummary(paths.pagesDir, pageId);
}

export function getLatestTextClassificationPath(
  label: string,
  pageId: string
): { filePath: string; version: number } | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.textClassificationDir;
  const baseFile = path.join(dir, `${pageId}.json`);
  if (!fs.existsSync(baseFile)) return null;

  if (!fs.existsSync(dir)) return null;
  const versionRe = new RegExp(`^${pageId}\\.v(\\d{3})\\.json$`);
  let maxVersion = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = versionRe.exec(f);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > maxVersion) maxVersion = v;
    }
  }

  if (maxVersion === 0) {
    return { filePath: baseFile, version: 1 };
  }

  const versionedFile = path.join(
    dir,
    `${pageId}.v${String(maxVersion).padStart(3, "0")}.json`
  );
  return { filePath: versionedFile, version: maxVersion };
}

export function listTextClassificationVersions(
  label: string,
  pageId: string
): number[] {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.textClassificationDir;
  const baseFile = path.join(dir, `${pageId}.json`);
  if (!fs.existsSync(baseFile)) return [];

  const versions = [1];
  const versionRe = new RegExp(`^${pageId}\\.v(\\d{3})\\.json$`);
  for (const f of fs.readdirSync(dir)) {
    const m = versionRe.exec(f);
    if (m) versions.push(parseInt(m[1], 10));
  }
  return [...new Set(versions)].sort((a, b) => a - b);
}

export function getTextClassificationVersion(
  label: string,
  pageId: string,
  version: number
): PageTextClassification | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.textClassificationDir;
  const filePath =
    version === 1
      ? path.join(dir, `${pageId}.json`)
      : path.join(dir, `${pageId}.v${String(version).padStart(3, "0")}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PageTextClassification;
}

export function getCurrentTextClassificationVersion(
  label: string,
  pageId: string
): number {
  const paths = resolveBookPaths(label, getBooksRoot());
  const currentFile = path.join(paths.textClassificationDir, `${pageId}.current`);
  if (fs.existsSync(currentFile)) {
    const content = fs.readFileSync(currentFile, "utf-8").trim();
    const v = parseInt(content, 10);
    if (!isNaN(v)) return v;
  }
  // Default to latest version
  const versions = listTextClassificationVersions(label, pageId);
  return versions.length > 0 ? versions[versions.length - 1] : 1;
}

export function setCurrentTextClassificationVersion(
  label: string,
  pageId: string,
  version: number
): void {
  const paths = resolveBookPaths(label, getBooksRoot());
  fs.writeFileSync(
    path.join(paths.textClassificationDir, `${pageId}.current`),
    String(version),
    "utf-8"
  );
}

export function getTextClassification(
  label: string,
  pageId: string
): { data: PageTextClassification; version: number } | null {
  const versions = listTextClassificationVersions(label, pageId);
  if (versions.length === 0) return null;

  const current = getCurrentTextClassificationVersion(label, pageId);
  const data = getTextClassificationVersion(label, pageId, current);
  if (!data) return null;
  return { data, version: current };
}

export function resolvePageImagePath(label: string, pageId: string): string {
  const paths = resolveBookPaths(label, getBooksRoot());
  return path.join(paths.pagesDir, pageId, "page.png");
}

export function resolveExtractedImagePath(
  label: string,
  pageId: string,
  imageId: string
): string {
  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);

  // Look up path from classification entry
  const classification = getImageClassification(label, pageId);
  const entry = classification?.data.images.find((i) => i.image_id === imageId);
  if (entry?.path) {
    return path.join(paths.bookDir, entry.path);
  }

  // Fallback for images without classification data
  return path.join(paths.pagesDir, pageId, "images", `${imageId}.png`);
}

export function resolveCoverImagePath(label: string): string | null {
  const metadata = getBookMetadata(label);
  if (!metadata?.cover_page_number) return null;
  const pageId = "pg" + String(metadata.cover_page_number).padStart(3, "0");
  return resolvePageImagePath(label, pageId);
}

export function getLatestImageClassificationPath(
  label: string,
  pageId: string
): { filePath: string; version: number } | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.imageClassificationDir;
  const baseFile = path.join(dir, `${pageId}.json`);
  if (!fs.existsSync(baseFile)) return null;

  if (!fs.existsSync(dir)) return null;
  const versionRe = new RegExp(`^${pageId}\\.v(\\d{3})\\.json$`);
  let maxVersion = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = versionRe.exec(f);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > maxVersion) maxVersion = v;
    }
  }

  if (maxVersion === 0) {
    return { filePath: baseFile, version: 1 };
  }

  const versionedFile = path.join(
    dir,
    `${pageId}.v${String(maxVersion).padStart(3, "0")}.json`
  );
  return { filePath: versionedFile, version: maxVersion };
}

export function listImageClassificationVersions(
  label: string,
  pageId: string
): number[] {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.imageClassificationDir;
  const baseFile = path.join(dir, `${pageId}.json`);
  if (!fs.existsSync(baseFile)) return [];

  const versions = [1];
  const versionRe = new RegExp(`^${pageId}\\.v(\\d{3})\\.json$`);
  for (const f of fs.readdirSync(dir)) {
    const m = versionRe.exec(f);
    if (m) versions.push(parseInt(m[1], 10));
  }
  return [...new Set(versions)].sort((a, b) => a - b);
}

export function getImageClassificationVersion(
  label: string,
  pageId: string,
  version: number
): PageImageClassification | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.imageClassificationDir;
  const filePath =
    version === 1
      ? path.join(dir, `${pageId}.json`)
      : path.join(dir, `${pageId}.v${String(version).padStart(3, "0")}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PageImageClassification;
}

export function getCurrentImageClassificationVersion(
  label: string,
  pageId: string
): number {
  const paths = resolveBookPaths(label, getBooksRoot());
  const currentFile = path.join(paths.imageClassificationDir, `${pageId}.current`);
  if (fs.existsSync(currentFile)) {
    const content = fs.readFileSync(currentFile, "utf-8").trim();
    const v = parseInt(content, 10);
    if (!isNaN(v)) return v;
  }
  const versions = listImageClassificationVersions(label, pageId);
  return versions.length > 0 ? versions[versions.length - 1] : 1;
}

export function setCurrentImageClassificationVersion(
  label: string,
  pageId: string,
  version: number
): void {
  const paths = resolveBookPaths(label, getBooksRoot());
  fs.writeFileSync(
    path.join(paths.imageClassificationDir, `${pageId}.current`),
    String(version),
    "utf-8"
  );
}

export function getImageClassification(
  label: string,
  pageId: string
): { data: PageImageClassification; version: number } | null {
  const versions = listImageClassificationVersions(label, pageId);
  if (versions.length === 0) return null;

  const current = getCurrentImageClassificationVersion(label, pageId);
  const data = getImageClassificationVersion(label, pageId, current);
  if (!data) return null;
  return { data, version: current };
}

/**
 * Load extracted images as base64, excluding any pruned by image classification.
 * When classification data exists, uses entry paths to resolve files.
 * Falls back to scanning imagesDir when no classification is available.
 * @param bookDir  Absolute path to the book root directory.
 * @param imagesDir  Path to the extraction images directory.
 * @param imageClassification  Pre-loaded classification (if null/undefined, no filtering is applied).
 */
export function loadUnprunedImagesFromDir(
  bookDir: string,
  imagesDir: string,
  imageClassification?: PageImageClassification | null,
): { image_id: string; imageBase64: string }[] {
  const images: { image_id: string; imageBase64: string }[] = [];

  if (imageClassification) {
    // Use classification entries — each has a path relative to bookDir
    for (const entry of imageClassification.images) {
      if (entry.is_pruned) continue;
      const filePath = path.join(bookDir, entry.path);
      if (!fs.existsSync(filePath)) continue;
      const imgBase64 = fs.readFileSync(filePath).toString("base64");
      images.push({ image_id: entry.image_id, imageBase64: imgBase64 });
    }
  } else if (fs.existsSync(imagesDir)) {
    // No classification — load all images from extraction dir
    const imageFiles = fs
      .readdirSync(imagesDir)
      .filter((f) => /^pg\d{3}_im\d{3}\.png$/i.test(f))
      .sort();
    for (const imgFile of imageFiles) {
      const imageId = imgFile.replace(/\.png$/i, "");
      const imgBase64 = fs.readFileSync(path.join(imagesDir, imgFile)).toString("base64");
      images.push({ image_id: imageId, imageBase64: imgBase64 });
    }
  }

  return images;
}

/**
 * Load extracted images for a page as base64, excluding any pruned by image classification.
 * Convenience wrapper that resolves paths from label/pageId.
 */
export function loadUnprunedImages(
  label: string,
  pageId: string
): { image_id: string; imageBase64: string }[] {
  const paths = resolveBookPaths(label, getBooksRoot());
  const imagesDir = path.join(paths.pagesDir, pageId, "images");
  const result = getImageClassification(label, pageId);
  return loadUnprunedImagesFromDir(paths.bookDir, imagesDir, result?.data);
}

export function getPageSectioning(
  label: string,
  pageId: string
): PageSectioning | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const filePath = path.join(paths.pageSectioningDir, `${pageId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PageSectioning;
}

export { type PageSectioning } from "./pipeline/page-sectioning/page-sectioning-schema";
export { type PageImageClassification } from "./pipeline/image-classification/image-classification-schema";
export { type SectionRendering, type WebRendering } from "./pipeline/web-rendering/web-rendering-schema";

export function listWebRenderingVersions(
  label: string,
  sectionId: string
): number[] {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.webRenderingDir;
  const baseFile = path.join(dir, `${sectionId}.json`);
  if (!fs.existsSync(baseFile)) return [];

  const versions = [1];
  const versionRe = new RegExp(`^${sectionId}\\.v(\\d{3})\\.json$`);
  for (const f of fs.readdirSync(dir)) {
    const m = versionRe.exec(f);
    if (m) versions.push(parseInt(m[1], 10));
  }
  return [...new Set(versions)].sort((a, b) => a - b);
}

export function getWebRenderingVersion(
  label: string,
  sectionId: string,
  version: number
): SectionRendering | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.webRenderingDir;
  const filePath =
    version === 1
      ? path.join(dir, `${sectionId}.json`)
      : path.join(dir, `${sectionId}.v${String(version).padStart(3, "0")}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SectionRendering;
}

export function getCurrentWebRenderingVersion(
  label: string,
  sectionId: string
): number {
  const paths = resolveBookPaths(label, getBooksRoot());
  const currentFile = path.join(paths.webRenderingDir, `${sectionId}.current`);
  if (fs.existsSync(currentFile)) {
    const content = fs.readFileSync(currentFile, "utf-8").trim();
    const v = parseInt(content, 10);
    if (!isNaN(v)) return v;
  }
  const versions = listWebRenderingVersions(label, sectionId);
  return versions.length > 0 ? versions[versions.length - 1] : 1;
}

export function setCurrentWebRenderingVersion(
  label: string,
  sectionId: string,
  version: number
): void {
  const paths = resolveBookPaths(label, getBooksRoot());
  fs.writeFileSync(
    path.join(paths.webRenderingDir, `${sectionId}.current`),
    String(version),
    "utf-8"
  );
}

export type EnrichedSectionRendering = SectionRendering & {
  version: number;
  versions: number[];
};

export function getWebRendering(
  label: string,
  pageId: string
): { sections: EnrichedSectionRendering[] } | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.webRenderingDir;
  if (!fs.existsSync(dir)) return null;

  // Scan for base files matching {pageId}_s*.json (not versioned)
  const sectionRe = new RegExp(`^${pageId}_s(\\d{3})\\.json$`);
  const sectionIds: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    const m = sectionRe.exec(f);
    if (m) sectionIds.push(`${pageId}_s${m[1]}`);
  }

  if (sectionIds.length === 0) return null;

  sectionIds.sort();

  const sections: EnrichedSectionRendering[] = [];
  for (const sectionId of sectionIds) {
    const versions = listWebRenderingVersions(label, sectionId);
    const current = getCurrentWebRenderingVersion(label, sectionId);
    const data = getWebRenderingVersion(label, sectionId, current);
    if (!data) continue;
    sections.push({ ...data, version: current, versions });
  }

  return sections.length > 0 ? { sections } : null;
}

function countPages(pagesDir: string): number {
  if (!fs.existsSync(pagesDir)) return 0;
  return fs.readdirSync(pagesDir).filter((d) => /^pg\d{3}$/.test(d)).length;
}

function buildPageSummary(pagesDir: string, pageId: string): PageSummary {
  const pageDir = path.join(pagesDir, pageId);
  const imagesDir = path.join(pageDir, "images");
  const imageIds: string[] = [];

  if (fs.existsSync(imagesDir)) {
    for (const f of fs.readdirSync(imagesDir)) {
      if (/^pg\d{3}_im\d{3}\.png$/.test(f)) {
        imageIds.push(f.replace(/\.png$/, ""));
      }
    }
    imageIds.sort();
  }

  const textFile = path.join(pageDir, "text.txt");
  const rawText = fs.existsSync(textFile)
    ? fs.readFileSync(textFile, "utf-8")
    : "";

  return {
    pageId,
    hasImages: imageIds.length > 0,
    imageIds,
    rawText,
  };
}
