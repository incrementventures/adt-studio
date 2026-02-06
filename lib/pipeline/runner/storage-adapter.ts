/**
 * Storage Adapter
 *
 * Implements the Storage interface using SQLite and the filesystem.
 * This is the bridge between the pure pipeline and the existing data layer.
 */

import fs from "node:fs";
import path from "node:path";
import type { Storage } from "./types";
import type { Page, PageImage } from "../core/types";
import type {
  ImageClassificationOutput,
  TextClassificationOutput,
  PageSectioningOutput,
  SectionRendering,
} from "../core/schemas";
import {
  fromDBTextClassification,
  fromDBImageClassification,
  fromDBPageSectioning,
  fromDBSectionRendering,
  toDBTextClassification,
  toDBImageClassification,
  toDBPageSectioning,
  toDBSectionRendering,
} from "../core/schemas";
import { getDb } from "@/lib/db";
import {
  getBooksRoot,
  getBookMetadata as getBookMetadataFromDb,
  getExtractedImages,
  putPageText,
  putImage,
  putBookMetadata as putBookMetadataToDb,
  putPdfMetadata as putPdfMetadataToDb,
  hasImage,
} from "@/lib/books";
import { resolveBookPaths } from "@/lib/pipeline/types";
import type { ExtractedPage, ExtractedImage, PdfMetadata, BookMetadata } from "../steps";

// ============================================================================
// Storage factory
// ============================================================================

/**
 * Create a Storage instance for a specific book.
 */
export function createBookStorage(label: string): Storage {
  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);

  return {
    // -------------------------------------------------------------------------
    // Book-level operations
    // -------------------------------------------------------------------------

    async listPageIds(): Promise<string[]> {
      const db = getDb(label);
      const rows = db
        .prepare("SELECT page_id FROM pages ORDER BY page_id")
        .all() as { page_id: string }[];
      return rows.map((r) => r.page_id);
    },

    async getFirstPages(count: number): Promise<Page[]> {
      const db = getDb(label);
      const rows = db
        .prepare("SELECT page_id, page_number, text FROM pages ORDER BY page_id LIMIT ?")
        .all(count) as { page_id: string; page_number: number; text: string }[];

      const pages: Page[] = [];
      for (const row of rows) {
        const imagePath = path.join(paths.imagesDir, `${row.page_id}_page.png`);
        if (!fs.existsSync(imagePath)) continue;

        pages.push({
          pageId: row.page_id,
          pageNumber: row.page_number,
          rawText: row.text,
          pageImageBase64: fs.readFileSync(imagePath).toString("base64"),
        });
      }
      return pages;
    },

    async getBookMetadata(): Promise<BookMetadata | null> {
      return getBookMetadataFromDb(label);
    },

    async putBookMetadata(data: BookMetadata, source: "stub" | "llm"): Promise<void> {
      putBookMetadataToDb(label, source, data);
    },

    async putPdfMetadata(data: PdfMetadata): Promise<void> {
      putPdfMetadataToDb(label, data);
    },

    async putExtractedPage(page: ExtractedPage): Promise<void> {
      // Ensure images directory exists
      fs.mkdirSync(paths.imagesDir, { recursive: true });

      // Write page image
      const pageImagePath = path.join(paths.imagesDir, `${page.pageImage.imageId}.png`);
      fs.writeFileSync(pageImagePath, page.pageImage.pngBuffer);

      // Record page image in DB
      if (!hasImage(label, page.pageImage.imageId)) {
        putImage(
          label,
          page.pageImage.imageId,
          page.pageId,
          `images/${page.pageImage.imageId}.png`,
          page.pageImage.hash,
          page.pageImage.width,
          page.pageImage.height,
          "extract"
        );
      }

      // Write embedded images
      for (const img of page.images) {
        const imgPath = path.join(paths.imagesDir, `${img.imageId}.png`);
        fs.writeFileSync(imgPath, img.pngBuffer);

        if (!hasImage(label, img.imageId)) {
          putImage(
            label,
            img.imageId,
            page.pageId,
            `images/${img.imageId}.png`,
            img.hash,
            img.width,
            img.height,
            "extract"
          );
        }
      }

      // Write page text
      putPageText(label, page.pageId, page.pageNumber, page.text);
    },

    async putImage(image: ExtractedImage, source: "page" | "extract" | "crop"): Promise<void> {
      fs.mkdirSync(paths.imagesDir, { recursive: true });
      const imgPath = path.join(paths.imagesDir, `${image.imageId}.png`);
      fs.writeFileSync(imgPath, image.pngBuffer);

      if (!hasImage(label, image.imageId)) {
        putImage(
          label,
          image.imageId,
          image.pageId,
          `images/${image.imageId}.png`,
          image.hash,
          image.width,
          image.height,
          source
        );
      }
    },

    // -------------------------------------------------------------------------
    // Page-level read operations
    // -------------------------------------------------------------------------

    async getPage(pageId: string): Promise<Page | null> {
      const db = getDb(label);
      const row = db
        .prepare("SELECT page_id, page_number, text FROM pages WHERE page_id = ?")
        .get(pageId) as
        | { page_id: string; page_number: number; text: string }
        | undefined;

      if (!row) return null;

      const imagePath = path.join(paths.imagesDir, `${pageId}_page.png`);
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Page image not found: ${imagePath}`);
      }

      const pageImageBase64 = fs.readFileSync(imagePath).toString("base64");

      return {
        pageId: row.page_id,
        pageNumber: row.page_number,
        rawText: row.text,
        pageImageBase64,
      };
    },

    async getPageImages(pageId: string): Promise<PageImage[]> {
      // Get images from the latest image classification (includes crops)
      // Fall back to extracted images if no classification exists yet
      const classification = getVersionedNodeData<DBImageClassification>(
        label,
        "image-classification",
        pageId
      );

      const imageSources = classification
        ? classification.data.images
        : getExtractedImages(label, pageId).map((img) => ({
            image_id: img.image_id,
            path: img.path,
          }));

      const result: PageImage[] = [];

      for (const img of imageSources) {
        const absPath = path.join(paths.bookDir, img.path);
        if (!fs.existsSync(absPath)) continue;

        const buf = fs.readFileSync(absPath);
        const dimensions = pngDimensions(buf);

        result.push({
          imageId: img.image_id,
          imageBase64: buf.toString("base64"),
          width: dimensions.width,
          height: dimensions.height,
        });
      }

      return result;
    },

    async getBookLanguage(): Promise<string> {
      const metadata = getBookMetadataFromDb(label);
      return metadata?.language_code ?? "en";
    },

    async getImageClassification(
      pageId: string
    ): Promise<{ data: ImageClassificationOutput; version: number } | null> {
      const result = getVersionedNodeData<DBImageClassification>(
        label,
        "image-classification",
        pageId
      );
      if (!result) return null;

      return {
        data: fromDBImageClassification(result.data),
        version: result.version,
      };
    },

    async getTextClassification(
      pageId: string
    ): Promise<{ data: TextClassificationOutput; version: number } | null> {
      const result = getVersionedNodeData<DBTextClassification>(
        label,
        "text-classification",
        pageId
      );
      if (!result) return null;

      return {
        data: fromDBTextClassification(result.data),
        version: result.version,
      };
    },

    async getPageSectioning(
      pageId: string
    ): Promise<{ data: PageSectioningOutput; version: number } | null> {
      const result = getVersionedNodeData<DBPageSectioning>(
        label,
        "page-sectioning",
        pageId
      );
      if (!result) return null;

      return {
        data: fromDBPageSectioning(result.data),
        version: result.version,
      };
    },

    async getSectionRendering(
      sectionId: string
    ): Promise<{ data: SectionRendering; version: number } | null> {
      const result = getVersionedNodeData<DBSectionRendering | null>(
        label,
        "web-rendering",
        sectionId
      );
      if (!result || result.data === null) return null;

      return {
        data: fromDBSectionRendering(result.data),
        version: result.version,
      };
    },

    // -------------------------------------------------------------------------
    // Write operations
    // -------------------------------------------------------------------------

    async putImageClassification(
      pageId: string,
      data: ImageClassificationOutput
    ): Promise<{ version: number }> {
      // Enrich with paths and dimensions from DB (only extracted images - crops are added via UI)
      const extractedImages = getExtractedImages(label, pageId);
      const imgMap = new Map(extractedImages.map((img) => [img.image_id, img]));

      const dbData = {
        images: data.images.map((img) => {
          const dbImg = imgMap.get(img.imageId);
          return {
            image_id: img.imageId,
            path: dbImg?.path ?? `images/${img.imageId}.png`,
            width: dbImg?.width ?? 0,
            height: dbImg?.height ?? 0,
            is_pruned: img.isPruned,
          };
        }),
      };

      return putVersionedNodeData(label, "image-classification", pageId, dbData);
    },

    async putTextClassification(
      pageId: string,
      data: TextClassificationOutput
    ): Promise<{ version: number }> {
      const dbData = toDBTextClassification(data);
      return putVersionedNodeData(label, "text-classification", pageId, dbData);
    },

    async putPageSectioning(
      pageId: string,
      data: PageSectioningOutput,
      textClassificationVersion: number,
      imageClassificationVersion: number
    ): Promise<{ version: number }> {
      // Need to get the full text/image classification to embed in DB format
      const textResult = getVersionedNodeData<DBTextClassification>(
        label,
        "text-classification",
        pageId
      );
      const imageResult = getVersionedNodeData<DBImageClassification>(
        label,
        "image-classification",
        pageId
      );

      const textClassification = textResult
        ? fromDBTextClassification(textResult.data)
        : { reasoning: "", groups: [] };
      const imageClassification = imageResult
        ? fromDBImageClassification(imageResult.data)
        : { images: [] };

      const dbData = toDBPageSectioning(
        data,
        textClassification,
        imageClassification,
        textClassificationVersion,
        imageClassificationVersion
      );

      return putVersionedNodeData(label, "page-sectioning", pageId, dbData);
    },

    async putSectionRendering(
      sectionId: string,
      data: SectionRendering | null
    ): Promise<{ version: number }> {
      const dbData = data ? toDBSectionRendering(data) : null;
      return putVersionedNodeData(label, "web-rendering", sectionId, dbData);
    },
  };
}

// ============================================================================
// DB types (for storage compatibility)
// ============================================================================

interface DBImageClassification {
  images: Array<{
    image_id: string;
    path: string;
    is_pruned: boolean;
  }>;
}

interface DBTextClassification {
  reasoning: string;
  groups: Array<{
    group_id?: string;
    group_type: string;
    texts: Array<{ text_type: string; text: string; is_pruned: boolean }>;
  }>;
}

interface DBPageSectioning {
  reasoning: string;
  sections: Array<{
    section_type: string;
    part_ids: string[];
    background_color: string;
    text_color: string;
    page_number: number | null;
    is_pruned: boolean;
  }>;
  text_classification_version?: number;
  image_classification_version?: number;
  groups?: Record<
    string,
    {
      group_type: string;
      is_pruned?: boolean;
      texts: Array<{ text_type: string; text: string; is_pruned: boolean }>;
    }
  >;
  images?: Record<string, { is_pruned: boolean }>;
}

interface DBSectionRendering {
  section_index: number;
  section_type: string;
  reasoning: string;
  html: string;
}

// ============================================================================
// Database helpers
// ============================================================================

function getVersionedNodeData<T>(
  label: string,
  node: string,
  itemId: string
): { data: T; version: number } | null {
  const db = getDb(label);

  // Get all versions
  const rows = db
    .prepare(
      "SELECT version FROM node_data WHERE node = ? AND item_id = ? ORDER BY version"
    )
    .all(node, itemId) as { version: number }[];

  if (rows.length === 0) return null;

  const latestVersion = rows[rows.length - 1].version;

  // Get the data for latest version
  const row = db
    .prepare(
      "SELECT data FROM node_data WHERE node = ? AND item_id = ? AND version = ?"
    )
    .get(node, itemId, latestVersion) as { data: string } | undefined;

  if (!row || row.data === null) return null;

  return {
    data: JSON.parse(row.data) as T,
    version: latestVersion,
  };
}

function putVersionedNodeData(
  label: string,
  node: string,
  itemId: string,
  data: unknown
): { version: number } {
  const db = getDb(label);

  // Get existing versions
  const rows = db
    .prepare(
      "SELECT version FROM node_data WHERE node = ? AND item_id = ? ORDER BY version"
    )
    .all(node, itemId) as { version: number }[];

  const nextVersion = rows.length > 0 ? Math.max(...rows.map((r) => r.version)) + 1 : 1;

  // Insert new version
  db.prepare(
    `INSERT INTO node_data (node, item_id, version, data)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (node, item_id, version) DO UPDATE SET data = excluded.data`
  ).run(node, itemId, nextVersion, data !== null ? JSON.stringify(data) : null);

  return { version: nextVersion };
}

// ============================================================================
// Image helpers
// ============================================================================

/**
 * Read width and height from a PNG IHDR chunk (bytes 16–23).
 */
function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24) return { width: 0, height: 0 };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}
