import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { lastValueFrom, toArray } from "rxjs";
import { classifyText } from "../text-classification";
import { pageTextClassificationSchema } from "../text-classification-schema";
import { closeAllDbs } from "@/lib/db";

const booksRoot = path.resolve("fixtures");
const ravenPagesDir = path.join(booksRoot, "raven", "extract", "pages");
const hasPagesOnDisk = fs.existsSync(ravenPagesDir);

if (!hasPagesOnDisk) {
  console.warn(
    `Skipping text-classification integration tests: ${ravenPagesDir} not found`
  );
}

describe("text-classification integration", () => {
  let prevBooksRoot: string | undefined;

  beforeAll(() => {
    prevBooksRoot = process.env.BOOKS_ROOT;
    process.env.BOOKS_ROOT = booksRoot;
  });

  afterAll(() => {
    closeAllDbs();
    if (prevBooksRoot === undefined) delete process.env.BOOKS_ROOT;
    else process.env.BOOKS_ROOT = prevBooksRoot;
    // Clean up DB created during test
    const dbPath = path.join(booksRoot, "raven", "raven.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const walPath = dbPath + "-wal";
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    const shmPath = dbPath + "-shm";
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  it.skipIf(!hasPagesOnDisk)(
    "classifies text groups for raven and validates against schema",
    { timeout: 120_000 },
    async () => {
      const textClassificationDir = path.join(booksRoot, "raven", "text-classification");
      const alreadyComplete =
        fs.existsSync(textClassificationDir) &&
        fs.readdirSync(textClassificationDir).some((f) => /^pg\d{3}\.json$/.test(f));

      const progress$ = classifyText("raven", { outputRoot: booksRoot });
      const events = await lastValueFrom(progress$.pipe(toArray()));

      if (alreadyComplete) {
        // Step skips when output exists — no events emitted
        expect(events).toEqual([]);
      } else {
        const phases = events.map((e) => e.phase);
        expect(phases).toContain("loading");
        expect(phases).toContain("extracting");
      }
      const pageDirs = fs
        .readdirSync(ravenPagesDir)
        .filter((d) => /^pg\d{3}$/.test(d))
        .sort();

      expect(pageDirs.length).toBeGreaterThan(0);

      function readPage(dir: string) {
        const filePath = path.join(textClassificationDir, `${dir}.json`);
        expect(fs.existsSync(filePath)).toBe(true);
        return pageTextClassificationSchema.parse(
          JSON.parse(fs.readFileSync(filePath, "utf-8"))
        );
      }

      function allTextTypes(result: { groups: { texts: { text_type: string }[] }[] }) {
        return result.groups.flatMap((g) => g.texts.map((t) => t.text_type));
      }

      // pg001: cover page — should have title, author, and metadata
      const pg001 = readPage(pageDirs[0]);
      const pg001Types = allTextTypes(pg001);
      expect(pg001Types).toContain("book_title");
      expect(pg001Types).toContain("book_author");
      expect(pg001Types).toContain("book_metadata");

      // pg002: first narrative page — should have section text and a page number
      const pg002 = readPage(pageDirs[1]);
      const pg002Types = allTextTypes(pg002);
      expect(pg002Types).toContain("section_text");
      expect(pg002Types).toContain("page_number");

      // pg003: continuation — should also have section text
      const pg003 = readPage(pageDirs[2]);
      const pg003Types = allTextTypes(pg003);
      expect(pg003Types).toContain("section_text");
    }
  );

  it.skipIf(!hasPagesOnDisk)(
    "cached result matches schema",
    async () => {
      const cacheDir = path.join(booksRoot, "raven", "text-classification", ".cache");
      if (!fs.existsSync(cacheDir)) {
        console.warn("No cache directory found — skipping cache validation");
        return;
      }

      const cacheFiles = fs
        .readdirSync(cacheDir)
        .filter((f) => f.endsWith(".json"));
      expect(cacheFiles.length).toBeGreaterThan(0);

      // Validate at least one cache file parses as text classification
      // (cache may also contain metadata entries, so we only check parseable ones)
      let parsed = 0;
      for (const file of cacheFiles) {
        const raw = JSON.parse(
          fs.readFileSync(path.join(cacheDir, file), "utf-8")
        );
        const result = pageTextClassificationSchema.safeParse(raw);
        if (result.success) parsed++;
      }
      expect(parsed).toBeGreaterThan(0);
    }
  );
});
