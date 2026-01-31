import fs from "node:fs";
import path from "node:path";
import { resolveBookPaths } from "./pipeline/types";
import { bookMetadataSchema, type BookMetadata } from "./pipeline/metadata/metadata-schema";

interface TextEntry {
  text_type: string;
  text: string;
}

interface TextGroup {
  group_type: string;
  texts: TextEntry[];
}

export interface PageTextExtraction {
  reasoning: string;
  groups: TextGroup[];
}

export function getBooksRoot(): string {
  return path.resolve(process.env.BOOKS_ROOT ?? "fixtures");
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

export function getLatestTextExtractionPath(
  label: string,
  pageId: string
): { filePath: string; version: number } | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.textExtractionDir;
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

export function listTextExtractionVersions(
  label: string,
  pageId: string
): number[] {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.textExtractionDir;
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

export function getTextExtractionVersion(
  label: string,
  pageId: string,
  version: number
): PageTextExtraction | null {
  const paths = resolveBookPaths(label, getBooksRoot());
  const dir = paths.textExtractionDir;
  const filePath =
    version === 1
      ? path.join(dir, `${pageId}.json`)
      : path.join(dir, `${pageId}.v${String(version).padStart(3, "0")}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PageTextExtraction;
}

export function getCurrentTextExtractionVersion(
  label: string,
  pageId: string
): number {
  const paths = resolveBookPaths(label, getBooksRoot());
  const currentFile = path.join(paths.textExtractionDir, `${pageId}.current`);
  if (fs.existsSync(currentFile)) {
    const content = fs.readFileSync(currentFile, "utf-8").trim();
    const v = parseInt(content, 10);
    if (!isNaN(v)) return v;
  }
  // Default to latest version
  const versions = listTextExtractionVersions(label, pageId);
  return versions.length > 0 ? versions[versions.length - 1] : 1;
}

export function setCurrentTextExtractionVersion(
  label: string,
  pageId: string,
  version: number
): void {
  const paths = resolveBookPaths(label, getBooksRoot());
  fs.writeFileSync(
    path.join(paths.textExtractionDir, `${pageId}.current`),
    String(version),
    "utf-8"
  );
}

export function getTextExtraction(
  label: string,
  pageId: string
): { data: PageTextExtraction; version: number } | null {
  const versions = listTextExtractionVersions(label, pageId);
  if (versions.length === 0) return null;

  const current = getCurrentTextExtractionVersion(label, pageId);
  const data = getTextExtractionVersion(label, pageId, current);
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
  const paths = resolveBookPaths(label, getBooksRoot());
  return path.join(paths.pagesDir, pageId, "images", `${imageId}.png`);
}

export function resolveCoverImagePath(label: string): string | null {
  const metadata = getBookMetadata(label);
  if (!metadata?.cover_page_number) return null;
  const pageId = "pg" + String(metadata.cover_page_number).padStart(3, "0");
  return resolvePageImagePath(label, pageId);
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
      if (f.endsWith(".png")) {
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
