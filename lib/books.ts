import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { resolveBookPaths } from "./pipeline/types";
import { bookMetadataSchema, type BookMetadata } from "./pipeline/metadata/metadata-schema";
import type { PdfMetadata } from "./pipeline/extract/extract";
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

// ---------------------------------------------------------------------------
// Generic versioned-node helpers (private)
// ---------------------------------------------------------------------------

function listVersions(label: string, node: string, itemId: string): number[] {
  const db = getDb(label);
  const rows = db
    .prepare(
      "SELECT version FROM node_data WHERE node = ? AND item_id = ? ORDER BY version"
    )
    .all(node, itemId) as { version: number }[];
  return rows.map((r) => r.version);
}

function getVersionData<T>(
  label: string,
  node: string,
  itemId: string,
  version: number
): T | null {
  const db = getDb(label);
  const row = db
    .prepare(
      "SELECT data FROM node_data WHERE node = ? AND item_id = ? AND version = ?"
    )
    .get(node, itemId, version) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as T;
}

function getLatestVersion(
  label: string,
  node: string,
  itemId: string
): { version: number } | null {
  const versions = listVersions(label, node, itemId);
  if (versions.length === 0) return null;
  return { version: versions[versions.length - 1] };
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

export function putBookMetadata(
  label: string,
  source: "stub" | "llm",
  data: BookMetadata
): void {
  const db = getDb(label);
  db.prepare(
    `INSERT INTO book_metadata (source, data)
     VALUES (?, ?)
     ON CONFLICT (source) DO UPDATE SET data = excluded.data`
  ).run(source, JSON.stringify(data));
}

export function deleteBookMetadata(
  label: string,
  source: "stub" | "llm"
): void {
  const db = getDb(label);
  db.prepare("DELETE FROM book_metadata WHERE source = ?").run(source);
}

export function putPdfMetadata(label: string, data: PdfMetadata): void {
  const db = getDb(label);
  db.prepare(
    `INSERT INTO pdf_metadata (id, data)
     VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data`
  ).run(JSON.stringify(data));
}

export function putPageText(
  label: string,
  pageId: string,
  pageNumber: number,
  text: string
): void {
  const db = getDb(label);
  db.prepare(
    `INSERT INTO pages (page_id, page_number, text)
     VALUES (?, ?, ?)
     ON CONFLICT (page_id) DO UPDATE SET page_number = excluded.page_number, text = excluded.text`
  ).run(pageId, pageNumber, text);
}

export function putImage(
  label: string,
  imageId: string,
  pageId: string,
  imagePath: string,
  hash: string,
  width: number,
  height: number,
  source: "page" | "extract" | "crop"
): void {
  const db = getDb(label);
  db.prepare(
    `INSERT INTO images (image_id, page_id, path, hash, width, height, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(imageId, pageId, imagePath, hash, width, height, source);
}

export function hasImage(label: string, imageId: string): boolean {
  const db = getDb(label);
  const row = db
    .prepare("SELECT 1 FROM images WHERE image_id = ?")
    .get(imageId);
  return !!row;
}

export function getExtractedImages(
  label: string,
  pageId: string
): { image_id: string; path: string }[] {
  const db = getDb(label);
  return db
    .prepare(
      "SELECT image_id, path FROM images WHERE page_id = ? AND source = 'extract' ORDER BY CASE WHEN image_id LIKE '%_page' THEN 0 ELSE 1 END, image_id"
    )
    .all(pageId) as { image_id: string; path: string }[];
}

export function getMaxImageNum(label: string, pageId: string): number {
  const db = getDb(label);
  const row = db
    .prepare(
      "SELECT image_id FROM images WHERE page_id = ? AND image_id LIKE ? || '_im%' ORDER BY image_id DESC LIMIT 1"
    )
    .get(pageId, pageId) as { image_id: string } | undefined;
  if (!row) return 0;
  const m = /^pg\d{3}_im(\d{3})$/.exec(row.image_id);
  return m ? parseInt(m[1], 10) : 0;
}

export function getImageHashes(
  label: string,
  pageId: string
): Record<string, string> {
  const db = getDb(label);
  const rows = db
    .prepare(
      "SELECT image_id, hash FROM images WHERE page_id = ? AND hash IS NOT NULL"
    )
    .all(pageId) as { image_id: string; hash: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.image_id] = r.hash;
  return map;
}

export function getImageByHash(label: string, hash: string): string | null {
  const db = getDb(label);
  const row = db
    .prepare("SELECT path FROM images WHERE hash = ? LIMIT 1")
    .get(hash) as { path: string } | undefined;
  return row?.path ?? null;
}

export function putNodeData(
  label: string,
  node: string,
  itemId: string,
  version: number,
  data: unknown
): void {
  const db = getDb(label);
  db.prepare(
    `INSERT INTO node_data (node, item_id, version, data)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (node, item_id, version) DO UPDATE SET data = excluded.data`
  ).run(node, itemId, version, JSON.stringify(data));
}

export function resetNodeVersions(
  label: string,
  node: string,
  itemId: string
): void {
  const db = getDb(label);
  db.prepare(
    "DELETE FROM node_data WHERE node = ? AND item_id = ? AND version > 1"
  ).run(node, itemId);
}

export function appendLlmLog(label: string, entry: unknown): void {
  const db = getDb(label);
  const e = entry as { timestamp?: string };
  const timestamp = e.timestamp ?? new Date().toISOString();
  db.prepare("INSERT INTO llm_log (timestamp, data) VALUES (?, ?)").run(
    timestamp,
    JSON.stringify(entry)
  );
  // Trim to 250 rows (keep newest)
  db.prepare(
    `DELETE FROM llm_log WHERE id NOT IN (
       SELECT id FROM llm_log ORDER BY id DESC LIMIT 250
     )`
  ).run();
}

// ---------------------------------------------------------------------------
// Book-level reads
// ---------------------------------------------------------------------------

export function listBooks(): BookSummary[] {
  const root = getBooksRoot();
  if (!fs.existsSync(root)) return [];

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const books: BookSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const label = entry.name;
    const dbPath = path.join(root, label, `${label}.db`);
    if (!fs.existsSync(dbPath)) continue;

    try {
      const metadata = getBookMetadata(label);
      if (!metadata) continue;

      const pageCount = countPages(label);
      books.push({ label, metadata, pageCount });
    } catch {
      // Skip books with incompatible DB schemas
    }
  }

  return books.sort((a, b) => a.label.localeCompare(b.label));
}

export function getBookMetadata(label: string): BookMetadata | null {
  const db = getDb(label);
  // Prefer LLM metadata, fall back to stub
  const row = db
    .prepare(
      `SELECT data FROM book_metadata
       WHERE source = 'llm'
       UNION ALL
       SELECT data FROM book_metadata
       WHERE source = 'stub'
       LIMIT 1`
    )
    .get() as { data: string } | undefined;
  if (!row) return null;
  const raw = JSON.parse(row.data);
  const result = bookMetadataSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function getPdfMetadata(label: string): PdfMetadata | null {
  const db = getDb(label);
  const row = db
    .prepare("SELECT data FROM pdf_metadata WHERE id = 1")
    .get() as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as PdfMetadata;
}

// ---------------------------------------------------------------------------
// Page listing
// ---------------------------------------------------------------------------

export interface PageSummary {
  pageId: string;
  hasImages: boolean;
  imageIds: string[];
  rawText: string;
}

export function listPages(label: string): PageSummary[] {
  const db = getDb(label);
  const rows = db
    .prepare("SELECT page_id FROM pages ORDER BY page_id")
    .all() as { page_id: string }[];
  return rows.map((row) => buildPageSummary(label, row.page_id));
}

export function getPage(label: string, pageId: string): PageSummary | null {
  const db = getDb(label);
  const row = db
    .prepare("SELECT page_id FROM pages WHERE page_id = ?")
    .get(pageId) as { page_id: string } | undefined;
  if (!row) return null;
  return buildPageSummary(label, pageId);
}

// ---------------------------------------------------------------------------
// Text classification
// ---------------------------------------------------------------------------

export function getLatestTextClassificationPath(
  label: string,
  pageId: string
): { version: number } | null {
  return getLatestVersion(label, "text-classification", pageId);
}

export function listTextClassificationVersions(
  label: string,
  pageId: string
): number[] {
  return listVersions(label, "text-classification", pageId);
}

export function getTextClassificationVersion(
  label: string,
  pageId: string,
  version: number
): PageTextClassification | null {
  return getVersionData<PageTextClassification>(
    label,
    "text-classification",
    pageId,
    version
  );
}

export function getTextClassification(
  label: string,
  pageId: string
): { data: PageTextClassification; version: number } | null {
  const versions = listTextClassificationVersions(label, pageId);
  if (versions.length === 0) return null;

  const latest = versions[versions.length - 1];
  const data = getTextClassificationVersion(label, pageId, latest);
  if (!data) return null;
  return { data, version: latest };
}

// ---------------------------------------------------------------------------
// Image paths (stay on disk)
// ---------------------------------------------------------------------------

export function resolvePageImagePath(label: string, pageId: string): string {
  const paths = resolveBookPaths(label, getBooksRoot());
  return path.join(paths.imagesDir, `${pageId}_page.png`);
}

export function resolveExtractedImagePath(
  label: string,
  pageId: string,
  imageId: string
): string {
  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);

  // Look up the image path from DB first
  const db = getDb(label);
  const row = db
    .prepare("SELECT path FROM images WHERE image_id = ?")
    .get(imageId) as { path: string } | undefined;
  if (row?.path) {
    return path.join(paths.bookDir, row.path);
  }

  return path.join(paths.imagesDir, `${imageId}.png`);
}

export function resolveCoverImagePath(label: string): string | null {
  const metadata = getBookMetadata(label);
  if (!metadata?.cover_page_number) return null;
  const pageId = "pg" + String(metadata.cover_page_number).padStart(3, "0");
  return resolvePageImagePath(label, pageId);
}

// ---------------------------------------------------------------------------
// Image classification
// ---------------------------------------------------------------------------

export function getLatestImageClassificationPath(
  label: string,
  pageId: string
): { version: number } | null {
  return getLatestVersion(label, "image-classification", pageId);
}

export function listImageClassificationVersions(
  label: string,
  pageId: string
): number[] {
  return listVersions(label, "image-classification", pageId);
}

export function getImageClassificationVersion(
  label: string,
  pageId: string,
  version: number
): PageImageClassification | null {
  return getVersionData<PageImageClassification>(
    label,
    "image-classification",
    pageId,
    version
  );
}

export function getImageClassification(
  label: string,
  pageId: string
): { data: PageImageClassification; version: number } | null {
  const versions = listImageClassificationVersions(label, pageId);
  if (versions.length === 0) return null;

  const latest = versions[versions.length - 1];
  const data = getImageClassificationVersion(label, pageId, latest);
  if (!data) return null;
  return { data, version: latest };
}

// ---------------------------------------------------------------------------
// Unpruned images
// ---------------------------------------------------------------------------

export function loadUnprunedImages(
  label: string,
  pageId: string
): { image_id: string; imageBase64: string }[] {
  const paths = resolveBookPaths(label, getBooksRoot());
  const result = getImageClassification(label, pageId);
  const images: { image_id: string; imageBase64: string }[] = [];

  if (result?.data) {
    for (const entry of result.data.images) {
      if (entry.is_pruned) continue;
      const filePath = path.join(paths.bookDir, entry.path);
      if (!fs.existsSync(filePath)) continue;
      const imgBase64 = fs.readFileSync(filePath).toString("base64");
      images.push({ image_id: entry.image_id, imageBase64: imgBase64 });
    }
  } else {
    // Fallback: use DB extract-source images
    for (const row of getExtractedImages(label, pageId)) {
      const filePath = path.join(paths.bookDir, row.path);
      if (!fs.existsSync(filePath)) continue;
      const imgBase64 = fs.readFileSync(filePath).toString("base64");
      images.push({ image_id: row.image_id, imageBase64: imgBase64 });
    }
  }

  return images;
}

export function loadUnprunedImagesFromDir(
  label: string,
  pageId: string,
  bookDir: string,
  imageClassification?: PageImageClassification | null
): { image_id: string; imageBase64: string }[] {
  const images: { image_id: string; imageBase64: string }[] = [];

  if (imageClassification) {
    for (const entry of imageClassification.images) {
      if (entry.is_pruned) continue;
      const filePath = path.join(bookDir, entry.path);
      if (!fs.existsSync(filePath)) continue;
      const imgBase64 = fs.readFileSync(filePath).toString("base64");
      images.push({ image_id: entry.image_id, imageBase64: imgBase64 });
    }
  } else {
    for (const row of getExtractedImages(label, pageId)) {
      const filePath = path.join(bookDir, row.path);
      if (!fs.existsSync(filePath)) continue;
      const imgBase64 = fs.readFileSync(filePath).toString("base64");
      images.push({ image_id: row.image_id, imageBase64: imgBase64 });
    }
  }

  return images;
}

// ---------------------------------------------------------------------------
// Page sectioning
// ---------------------------------------------------------------------------

export function listPageSectioningVersions(
  label: string,
  pageId: string
): number[] {
  return listVersions(label, "page-sectioning", pageId);
}

export function getPageSectioningVersion(
  label: string,
  pageId: string,
  version: number
): PageSectioning | null {
  return getVersionData<PageSectioning>(
    label,
    "page-sectioning",
    pageId,
    version
  );
}

export function getPageSectioning(
  label: string,
  pageId: string
): { data: PageSectioning; version: number } | null {
  const versions = listPageSectioningVersions(label, pageId);
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  const data = getPageSectioningVersion(label, pageId, latest);
  if (!data) return null;
  return { data, version: latest };
}

export { type PageSectioning } from "./pipeline/page-sectioning/page-sectioning-schema";
export { type PageImageClassification } from "./pipeline/image-classification/image-classification-schema";
export { type SectionRendering, type WebRendering } from "./pipeline/web-rendering/web-rendering-schema";
export { type LlmLogEntry } from "./pipeline/llm-log";

// ---------------------------------------------------------------------------
// Web rendering
// ---------------------------------------------------------------------------

export function listWebRenderingVersions(
  label: string,
  sectionId: string
): number[] {
  return listVersions(label, "web-rendering", sectionId);
}

export function getWebRenderingVersion(
  label: string,
  sectionId: string,
  version: number
): SectionRendering | null {
  return getVersionData<SectionRendering>(
    label,
    "web-rendering",
    sectionId,
    version
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
  const db = getDb(label);

  // Find all section items for this page
  const rows = db
    .prepare(
      `SELECT DISTINCT item_id FROM node_data
       WHERE node = 'web-rendering' AND item_id LIKE ? || '_s%'
       ORDER BY item_id`
    )
    .all(pageId) as { item_id: string }[];

  if (rows.length === 0) return null;

  const sections: EnrichedSectionRendering[] = [];
  for (const row of rows) {
    const sectionId = row.item_id;
    const versions = listWebRenderingVersions(label, sectionId);
    if (versions.length === 0) continue;
    const latest = versions[versions.length - 1];
    const data = getWebRenderingVersion(label, sectionId, latest);
    if (!data) continue;
    sections.push({ ...data, version: latest, versions });
  }

  return sections.length > 0 ? { sections } : null;
}

// ---------------------------------------------------------------------------
// LLM log
// ---------------------------------------------------------------------------

export function getLlmLog(
  label: string,
  limit = 500
): import("./pipeline/llm-log").LlmLogEntry[] {
  const db = getDb(label);
  const rows = db
    .prepare("SELECT data FROM llm_log ORDER BY id DESC LIMIT ?")
    .all(limit) as { data: string }[];
  return rows.map(
    (r) => JSON.parse(r.data) as import("./pipeline/llm-log").LlmLogEntry
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function countPages(label: string): number {
  const db = getDb(label);
  const row = db
    .prepare("SELECT COUNT(*) as count FROM pages")
    .get() as { count: number };
  return row.count;
}

function buildPageSummary(
  label: string,
  pageId: string
): PageSummary {
  const db = getDb(label);

  // Get extracted image IDs from DB
  const imageRows = db
    .prepare(
      "SELECT image_id FROM images WHERE page_id = ? AND source = 'extract' ORDER BY CASE WHEN image_id LIKE '%_page' THEN 0 ELSE 1 END, image_id"
    )
    .all(pageId) as { image_id: string }[];
  const imageIds = imageRows.map((r) => r.image_id);

  // Read rawText from DB
  const row = db
    .prepare("SELECT text FROM pages WHERE page_id = ?")
    .get(pageId) as { text: string } | undefined;
  const rawText = row?.text ?? "";

  return {
    pageId,
    hasImages: imageIds.length > 0,
    imageIds,
    rawText,
  };
}
