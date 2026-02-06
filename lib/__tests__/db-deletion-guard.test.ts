import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, closeDb, undeleteDb, closeAllDbs } from "@/lib/db";

function useBooksRoot(dir: string): () => void {
  const prev = process.env.BOOKS_ROOT;
  process.env.BOOKS_ROOT = dir;
  return () => {
    closeAllDbs();
    if (prev === undefined) delete process.env.BOOKS_ROOT;
    else process.env.BOOKS_ROOT = prev;
  };
}

describe("DB deletion guard", () => {
  const label = "guard-test";
  let tmpDir: string;
  let restoreBooksRoot: () => void;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-guard-test-"));
    fs.mkdirSync(path.join(tmpDir, label), { recursive: true });
  });

  beforeEach(() => {
    restoreBooksRoot = useBooksRoot(tmpDir);
    // Ensure label is not in the deleted set from a previous test
    undeleteDb(label);
  });

  afterEach(() => {
    restoreBooksRoot();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getDb works normally", () => {
    const db = getDb(label);
    expect(db).toBeTruthy();
  });

  it("closeDb blocks subsequent getDb calls", () => {
    // First open succeeds
    getDb(label);
    // Close marks as deleted
    closeDb(label);
    // Subsequent getDb should throw
    expect(() => getDb(label)).toThrow(/has been deleted/);
  });

  it("undeleteDb re-allows getDb after closeDb", () => {
    getDb(label);
    closeDb(label);
    expect(() => getDb(label)).toThrow(/has been deleted/);

    undeleteDb(label);
    // Now it should work again
    const db = getDb(label);
    expect(db).toBeTruthy();
  });
});
