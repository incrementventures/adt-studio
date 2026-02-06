import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, closeAllDbs, SCHEMA_VERSION, SchemaMismatchError } from "@/lib/db";
import {
  putBookMetadata,
  deleteBookMetadata,
  getBookMetadata,
  putPdfMetadata,
  getPdfMetadata,
  putPageText,
  listPages,
  getPage,
  countPages,
  putImage,
  hasImage,
  getExtractedImages,
  getMaxImageNum,
  getImageHashes,
  getImageByHash,
  putNodeData,
  resetNodeVersions,
  listTextClassificationVersions,
  getTextClassificationVersion,
  getTextClassification,
  getLatestTextClassificationPath,
  listImageClassificationVersions,
  getImageClassificationVersion,
  getImageClassification,
  getLatestImageClassificationPath,
  listPageSectioningVersions,
  getPageSectioningVersion,
  getPageSectioning,
  listWebRenderingVersions,
  getWebRenderingVersion,
  getWebRendering,
  appendLlmLog,
  getLlmLog,
} from "@/lib/books";
import type { BookMetadata } from "@/lib/pipeline/metadata/metadata-schema";

function useBooksRoot(dir: string): () => void {
  const prev = process.env.BOOKS_ROOT;
  process.env.BOOKS_ROOT = dir;
  return () => {
    closeAllDbs();
    if (prev === undefined) delete process.env.BOOKS_ROOT;
    else process.env.BOOKS_ROOT = prev;
  };
}

const VALID_METADATA: BookMetadata = {
  title: "Test Book",
  authors: ["Author One"],
  publisher: "Test Publisher",
  language_code: "en",
  cover_page_number: 1,
  reasoning: "test reasoning",
};

describe("books.ts database functions", () => {
  const label = "testbook";
  let tmpDir: string;
  let restoreBooksRoot: () => void;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "books-test-"));
    fs.mkdirSync(path.join(tmpDir, label), { recursive: true });
  });

  beforeEach(() => {
    restoreBooksRoot = useBooksRoot(tmpDir);
  });

  afterEach(() => {
    restoreBooksRoot();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Schema & DB basics
  // -------------------------------------------------------------------------

  describe("schema initialization", () => {
    it("getDb creates a fresh database with schema", () => {
      const db = getDb(label);
      expect(db).toBeTruthy();

      const row = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(row.version).toBe(SCHEMA_VERSION);
    });

    it("getDb returns the same cached connection", () => {
      const db1 = getDb(label);
      const db2 = getDb(label);
      expect(db1).toBe(db2);
    });
  });

  // -------------------------------------------------------------------------
  // Book metadata
  // -------------------------------------------------------------------------

  describe("book metadata", () => {
    it("getBookMetadata returns null on empty DB", () => {
      expect(getBookMetadata(label)).toBeNull();
    });

    it("putBookMetadata + getBookMetadata round-trip (stub)", () => {
      putBookMetadata(label, "stub", VALID_METADATA);
      const result = getBookMetadata(label);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Test Book");
      expect(result!.authors).toEqual(["Author One"]);
    });

    it("LLM metadata takes priority over stub", () => {
      putBookMetadata(label, "stub", { ...VALID_METADATA, title: "Stub Title" });
      putBookMetadata(label, "llm", { ...VALID_METADATA, title: "LLM Title" });
      const result = getBookMetadata(label);
      expect(result!.title).toBe("LLM Title");
    });

    it("deleteBookMetadata removes LLM, falls back to stub", () => {
      putBookMetadata(label, "stub", { ...VALID_METADATA, title: "Stub" });
      putBookMetadata(label, "llm", { ...VALID_METADATA, title: "LLM" });
      deleteBookMetadata(label, "llm");
      const result = getBookMetadata(label);
      expect(result!.title).toBe("Stub");
    });

    it("putBookMetadata upserts on conflict", () => {
      putBookMetadata(label, "stub", { ...VALID_METADATA, title: "First" });
      putBookMetadata(label, "stub", { ...VALID_METADATA, title: "Second" });
      const result = getBookMetadata(label);
      expect(result!.title).toBe("Second");
    });
  });

  // -------------------------------------------------------------------------
  // PDF metadata
  // -------------------------------------------------------------------------

  describe("pdf metadata", () => {
    it("getPdfMetadata returns null when not set", () => {
      expect(getPdfMetadata(label)).toBeNull();
    });

    it("putPdfMetadata + getPdfMetadata round-trip", () => {
      const data = { page_count: 10, width: 612, height: 792 };
      putPdfMetadata(label, data);
      expect(getPdfMetadata(label)).toEqual(data);
    });

    it("putPdfMetadata upserts on conflict", () => {
      putPdfMetadata(label, { page_count: 5 });
      putPdfMetadata(label, { page_count: 15 });
      expect(getPdfMetadata(label)).toEqual({ page_count: 15 });
    });
  });

  // -------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------

  describe("pages", () => {
    it("countPages returns 0 on empty DB", () => {
      expect(countPages(label)).toBe(0);
    });

    it("putPageText + countPages", () => {
      putPageText(label, "pg001", 1, "Page one text");
      putPageText(label, "pg002", 2, "Page two text");
      expect(countPages(label)).toBe(2);
    });

    it("getPage returns page summary", () => {
      putPageText(label, "pg001", 1, "Hello world");
      const page = getPage(label, "pg001");
      expect(page).not.toBeNull();
      expect(page!.pageId).toBe("pg001");
      expect(page!.rawText).toBe("Hello world");
    });

    it("getPage returns null for non-existent page", () => {
      expect(getPage(label, "pg999")).toBeNull();
    });

    it("listPages returns all pages in order", () => {
      putPageText(label, "pg002", 2, "Two");
      putPageText(label, "pg001", 1, "One");
      const pages = listPages(label);
      expect(pages.length).toBeGreaterThanOrEqual(2);
      const ids = pages.map((p) => p.pageId);
      expect(ids.indexOf("pg001")).toBeLessThan(ids.indexOf("pg002"));
    });

    it("putPageText upserts on conflict", () => {
      putPageText(label, "pg001", 1, "Original");
      putPageText(label, "pg001", 1, "Updated");
      const page = getPage(label, "pg001");
      expect(page!.rawText).toBe("Updated");
    });
  });

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  describe("images", () => {
    it("hasImage returns false when image doesn't exist", () => {
      expect(hasImage(label, "nonexistent")).toBe(false);
    });

    it("putImage + hasImage returns true", () => {
      putImage(label, "pg001_im001", "pg001", "images/pg001_im001.png", "hash1", 100, 200, "extract");
      expect(hasImage(label, "pg001_im001")).toBe(true);
    });

    it("getExtractedImages returns extract-source images", () => {
      putImage(label, "pg010_im001", "pg010", "images/pg010_im001.png", "h1", 100, 200, "extract");
      putImage(label, "pg010_im002", "pg010", "images/pg010_im002.png", "h2", 100, 200, "crop");
      const images = getExtractedImages(label, "pg010");
      expect(images.length).toBe(1);
      expect(images[0].image_id).toBe("pg010_im001");
    });

    it("getExtractedImages orders page images first", () => {
      putImage(label, "pg011_im001", "pg011", "images/pg011_im001.png", "h1", 100, 200, "extract");
      putImage(label, "pg011_page", "pg011", "images/pg011_page.png", "h0", 100, 200, "extract");
      const images = getExtractedImages(label, "pg011");
      expect(images[0].image_id).toBe("pg011_page");
      expect(images[1].image_id).toBe("pg011_im001");
    });

    it("getMaxImageNum parses image IDs", () => {
      putImage(label, "pg020_im001", "pg020", "images/pg020_im001.png", "", 10, 10, "extract");
      putImage(label, "pg020_im005", "pg020", "images/pg020_im005.png", "", 10, 10, "extract");
      expect(getMaxImageNum(label, "pg020")).toBe(5);
    });

    it("getMaxImageNum returns 0 when no images", () => {
      expect(getMaxImageNum(label, "pg099")).toBe(0);
    });

    it("getImageHashes returns hash map", () => {
      putImage(label, "pg030_im001", "pg030", "images/pg030_im001.png", "abc", 10, 10, "extract");
      putImage(label, "pg030_im002", "pg030", "images/pg030_im002.png", "def", 10, 10, "extract");
      const hashes = getImageHashes(label, "pg030");
      expect(hashes["pg030_im001"]).toBe("abc");
      expect(hashes["pg030_im002"]).toBe("def");
    });

    it("getImageByHash finds image by hash", () => {
      putImage(label, "pg040_im001", "pg040", "images/pg040_im001.png", "unique_hash", 10, 10, "extract");
      expect(getImageByHash(label, "unique_hash")).toBe("images/pg040_im001.png");
    });

    it("getImageByHash returns null for unknown hash", () => {
      expect(getImageByHash(label, "no_such_hash")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Node data & versioning
  // -------------------------------------------------------------------------

  describe("node data", () => {
    it("putNodeData stores versioned data", () => {
      putNodeData(label, "test-node", "item1", 1, { foo: "bar" });
      const db = getDb(label);
      const row = db
        .prepare(
          "SELECT data FROM node_data WHERE node = 'test-node' AND item_id = 'item1' AND version = 1"
        )
        .get() as { data: string };
      expect(JSON.parse(row.data)).toEqual({ foo: "bar" });
    });

    it("putNodeData upserts on conflict", () => {
      putNodeData(label, "test-node", "item2", 1, { v: 1 });
      putNodeData(label, "test-node", "item2", 1, { v: 2 });
      const db = getDb(label);
      const row = db
        .prepare(
          "SELECT data FROM node_data WHERE node = 'test-node' AND item_id = 'item2' AND version = 1"
        )
        .get() as { data: string };
      expect(JSON.parse(row.data)).toEqual({ v: 2 });
    });

    it("putNodeData accepts null data", () => {
      putNodeData(label, "test-node", "null-item", 1, null);
      const db = getDb(label);
      const row = db
        .prepare(
          "SELECT data FROM node_data WHERE node = 'test-node' AND item_id = 'null-item' AND version = 1"
        )
        .get() as { data: string | null };
      expect(row.data).toBeNull();
    });

    it("resetNodeVersions removes versions > 1", () => {
      putNodeData(label, "test-node", "reset-item", 1, { v: 1 });
      putNodeData(label, "test-node", "reset-item", 2, { v: 2 });
      putNodeData(label, "test-node", "reset-item", 3, { v: 3 });
      resetNodeVersions(label, "test-node", "reset-item");
      const db = getDb(label);
      const rows = db
        .prepare(
          "SELECT version FROM node_data WHERE node = 'test-node' AND item_id = 'reset-item' ORDER BY version"
        )
        .all() as { version: number }[];
      expect(rows.map((r) => r.version)).toEqual([1]);
    });
  });

  // -------------------------------------------------------------------------
  // Text classification
  // -------------------------------------------------------------------------

  describe("text classification", () => {
    const tcData = {
      reasoning: "test reasoning",
      groups: [
        {
          group_type: "body",
          texts: [{ text_type: "paragraph", text: "Hello", is_pruned: false }],
        },
      ],
    };

    it("returns empty/null when no data", () => {
      expect(listTextClassificationVersions(label, "tc_pg001")).toEqual([]);
      expect(getTextClassificationVersion(label, "tc_pg001", 1)).toBeNull();
      expect(getTextClassification(label, "tc_pg001")).toBeNull();
      expect(getLatestTextClassificationPath(label, "tc_pg001")).toBeNull();
    });

    it("single version round-trip", () => {
      putNodeData(label, "text-classification", "tc_pg002", 1, tcData);
      expect(listTextClassificationVersions(label, "tc_pg002")).toEqual([1]);
      expect(getTextClassificationVersion(label, "tc_pg002", 1)).toEqual(tcData);
      expect(getLatestTextClassificationPath(label, "tc_pg002")).toEqual({ version: 1 });
    });

    it("multiple versions, getTextClassification returns latest", () => {
      const v2Data = { ...tcData, reasoning: "v2" };
      putNodeData(label, "text-classification", "tc_pg003", 1, tcData);
      putNodeData(label, "text-classification", "tc_pg003", 2, v2Data);
      const result = getTextClassification(label, "tc_pg003");
      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
      expect(result!.data.reasoning).toBe("v2");
    });
  });

  // -------------------------------------------------------------------------
  // Image classification
  // -------------------------------------------------------------------------

  describe("image classification", () => {
    const icData = {
      images: [
        { image_id: "ic_im001", path: "images/ic_im001.png", is_pruned: false },
      ],
    };

    it("returns empty/null when no data", () => {
      expect(listImageClassificationVersions(label, "ic_pg001")).toEqual([]);
      expect(getImageClassificationVersion(label, "ic_pg001", 1)).toBeNull();
      expect(getImageClassification(label, "ic_pg001")).toBeNull();
      expect(getLatestImageClassificationPath(label, "ic_pg001")).toBeNull();
    });

    it("single version round-trip", () => {
      putNodeData(label, "image-classification", "ic_pg002", 1, icData);
      expect(listImageClassificationVersions(label, "ic_pg002")).toEqual([1]);
      expect(getImageClassificationVersion(label, "ic_pg002", 1)).toEqual(icData);
      expect(getLatestImageClassificationPath(label, "ic_pg002")).toEqual({ version: 1 });
    });

    it("multiple versions, getImageClassification returns latest", () => {
      const v2 = { images: [{ image_id: "ic_im002", path: "img.png", is_pruned: true }] };
      putNodeData(label, "image-classification", "ic_pg003", 1, icData);
      putNodeData(label, "image-classification", "ic_pg003", 2, v2);
      const result = getImageClassification(label, "ic_pg003");
      expect(result!.version).toBe(2);
      expect(result!.data.images[0].is_pruned).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Page sectioning
  // -------------------------------------------------------------------------

  describe("page sectioning", () => {
    const psData = {
      reasoning: "sectioning test",
      sections: [
        {
          section_type: "content",
          part_ids: ["g001"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
    };

    it("returns empty/null when no data", () => {
      expect(listPageSectioningVersions(label, "ps_pg001")).toEqual([]);
      expect(getPageSectioningVersion(label, "ps_pg001", 1)).toBeNull();
      expect(getPageSectioning(label, "ps_pg001")).toBeNull();
    });

    it("single version round-trip", () => {
      putNodeData(label, "page-sectioning", "ps_pg002", 1, psData);
      expect(listPageSectioningVersions(label, "ps_pg002")).toEqual([1]);
      expect(getPageSectioningVersion(label, "ps_pg002", 1)).toEqual(psData);
    });

    it("getPageSectioning returns latest version", () => {
      const v2 = { ...psData, reasoning: "v2" };
      putNodeData(label, "page-sectioning", "ps_pg003", 1, psData);
      putNodeData(label, "page-sectioning", "ps_pg003", 2, v2);
      const result = getPageSectioning(label, "ps_pg003");
      expect(result!.version).toBe(2);
      expect(result!.data.reasoning).toBe("v2");
    });
  });

  // -------------------------------------------------------------------------
  // Web rendering
  // -------------------------------------------------------------------------

  describe("web rendering", () => {
    it("getWebRendering returns null when no sections", () => {
      expect(getWebRendering(label, "wr_pg001")).toBeNull();
    });

    it("single section round-trip", () => {
      const section = {
        section_index: 0,
        section_type: "content",
        reasoning: "test",
        html: "<p>Hello</p>",
      };
      putNodeData(label, "web-rendering", "wr_pg002_s001", 1, section);
      const result = getWebRendering(label, "wr_pg002");
      expect(result).not.toBeNull();
      expect(result!.sections).toHaveLength(1);
      expect(result!.sections[0].html).toBe("<p>Hello</p>");
      expect(result!.sections[0].version).toBe(1);
      expect(result!.sections[0].versions).toEqual([1]);
    });

    it("multiple sections returned in order", () => {
      putNodeData(label, "web-rendering", "wr_pg003_s001", 1, {
        section_index: 0,
        section_type: "content",
        reasoning: "first",
        html: "<p>1</p>",
      });
      putNodeData(label, "web-rendering", "wr_pg003_s002", 1, {
        section_index: 1,
        section_type: "content",
        reasoning: "second",
        html: "<p>2</p>",
      });
      const result = getWebRendering(label, "wr_pg003");
      expect(result!.sections).toHaveLength(2);
      expect(result!.sections[0].html).toBe("<p>1</p>");
      expect(result!.sections[1].html).toBe("<p>2</p>");
    });

    it("null-data sections are skipped", () => {
      putNodeData(label, "web-rendering", "wr_pg004_s001", 1, {
        section_index: 0,
        section_type: "content",
        reasoning: "real",
        html: "<p>Real</p>",
      });
      putNodeData(label, "web-rendering", "wr_pg004_s002", 1, null);
      const result = getWebRendering(label, "wr_pg004");
      expect(result!.sections).toHaveLength(1);
      expect(result!.sections[0].html).toBe("<p>Real</p>");
    });

    it("listWebRenderingVersions returns version list", () => {
      putNodeData(label, "web-rendering", "wr_pg005_s001", 1, {
        section_index: 0,
        section_type: "content",
        reasoning: "v1",
        html: "<p>v1</p>",
      });
      putNodeData(label, "web-rendering", "wr_pg005_s001", 2, {
        section_index: 0,
        section_type: "content",
        reasoning: "v2",
        html: "<p>v2</p>",
      });
      expect(listWebRenderingVersions(label, "wr_pg005_s001")).toEqual([1, 2]);
    });

    it("getWebRenderingVersion returns specific version", () => {
      putNodeData(label, "web-rendering", "wr_pg006_s001", 1, {
        section_index: 0,
        section_type: "content",
        reasoning: "v1",
        html: "<p>v1</p>",
      });
      const v = getWebRenderingVersion(label, "wr_pg006_s001", 1);
      expect(v!.html).toBe("<p>v1</p>");
    });
  });

  // -------------------------------------------------------------------------
  // LLM log
  // -------------------------------------------------------------------------

  describe("llm log", () => {
    it("getLlmLog returns empty array initially", () => {
      expect(getLlmLog(label)).toEqual([]);
    });

    it("appendLlmLog + getLlmLog round-trip", () => {
      appendLlmLog(label, { type: "test", timestamp: "2025-01-01T00:00:00Z" });
      const log = getLlmLog(label);
      expect(log.length).toBeGreaterThanOrEqual(1);
      const entry = log.find((e: Record<string, unknown>) => (e as { type?: string }).type === "test");
      expect(entry).toBeTruthy();
    });

    it("getLlmLog respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        appendLlmLog(label, { idx: i, timestamp: `2025-01-0${i + 1}T00:00:00Z` });
      }
      const limited = getLlmLog(label, 2);
      expect(limited).toHaveLength(2);
    });

    it("appendLlmLog trims to 250 rows", () => {
      // Insert 260 entries
      for (let i = 0; i < 260; i++) {
        appendLlmLog(label, { bulk: true, idx: i, timestamp: `2025-06-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
      }
      const db = getDb(label);
      const row = db
        .prepare("SELECT COUNT(*) as count FROM llm_log")
        .get() as { count: number };
      expect(row.count).toBeLessThanOrEqual(250);
    });
  });
});
