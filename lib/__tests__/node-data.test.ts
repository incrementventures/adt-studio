import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, closeAllDbs } from "@/lib/db";
import {
  putNodeData,
  listWebRenderingVersions,
  getWebRendering,
} from "@/lib/books";

function useBooksRoot(dir: string): () => void {
  const prev = process.env.BOOKS_ROOT;
  process.env.BOOKS_ROOT = dir;
  return () => {
    closeAllDbs();
    if (prev === undefined) delete process.env.BOOKS_ROOT;
    else process.env.BOOKS_ROOT = prev;
  };
}

describe("node_data with NULL data", () => {
  const label = "testbook";
  let tmpDir: string;
  let restoreBooksRoot: () => void;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-data-test-"));
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

  it("putNodeData accepts null data", () => {
    expect(() => {
      putNodeData(label, "web-rendering", "pg001_s001", 1, null);
    }).not.toThrow();
  });

  it("null data row is visible in listVersions", () => {
    putNodeData(label, "web-rendering", "pg002_s001", 1, null);
    const versions = listWebRenderingVersions(label, "pg002_s001");
    expect(versions).toEqual([1]);
  });

  it("null data row stores SQL NULL", () => {
    putNodeData(label, "web-rendering", "pg003_s001", 1, null);
    const db = getDb(label);
    const row = db
      .prepare(
        "SELECT data FROM node_data WHERE node = 'web-rendering' AND item_id = 'pg003_s001' AND version = 1"
      )
      .get() as { data: string | null };
    expect(row.data).toBeNull();
  });

  it("getWebRendering returns sections array (not null) when only null-data rows exist", () => {
    putNodeData(label, "web-rendering", "pg004_s001", 1, null);
    const result = getWebRendering(label, "pg004");
    expect(result).not.toBeNull();
    expect(result!.sections).toEqual([]);
  });

  it("getWebRendering includes rendered sections and skips null-data sections", () => {
    const rendered = {
      section_index: 0,
      section_type: "content",
      reasoning: "test",
      html: "<p>Hello</p>",
    };
    putNodeData(label, "web-rendering", "pg005_s001", 1, rendered);
    putNodeData(label, "web-rendering", "pg005_s002", 1, null);

    const result = getWebRendering(label, "pg005");
    expect(result).not.toBeNull();
    expect(result!.sections).toHaveLength(1);
    expect(result!.sections[0].html).toBe("<p>Hello</p>");
    expect(result!.sections[0].version).toBe(1);
    expect(result!.sections[0].versions).toEqual([1]);
  });

  it("getWebRendering returns null when no rows exist at all", () => {
    const result = getWebRendering(label, "pg999");
    expect(result).toBeNull();
  });
});
