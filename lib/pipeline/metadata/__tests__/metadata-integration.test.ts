import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { lastValueFrom, toArray } from "rxjs";
import { extractMetadata } from "../metadata";
import { bookMetadataSchema } from "../metadata-schema";
import { closeAllDbs } from "@/lib/db";

const booksRoot = path.resolve("fixtures");
const ravenPagesDir = path.join(booksRoot, "raven", "extract", "pages");
const hasPagesOnDisk = fs.existsSync(ravenPagesDir);

if (!hasPagesOnDisk) {
  console.warn(
    `Skipping metadata integration tests: ${ravenPagesDir} not found`
  );
}

describe("metadata integration", () => {
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
    "extracts metadata for raven and validates against schema",
    { timeout: 120_000 },
    async () => {
      const metadataPath = path.join(booksRoot, "raven", "metadata", "metadata.json");
      const db = (await import("@/lib/db")).getDb("raven");
      const llmRow = db
        .prepare("SELECT data FROM book_metadata WHERE source = 'llm'")
        .get() as { data: string } | undefined;
      const alreadyComplete = !!llmRow;

      const progress$ = extractMetadata("raven", { outputRoot: booksRoot });
      const events = await lastValueFrom(progress$.pipe(toArray()));

      if (alreadyComplete) {
        // Step skips when output exists — no events emitted
        expect(events).toEqual([]);
      } else {
        const phases = events.map((e) => e.phase);
        expect(phases).toContain("loading");
        expect(phases).toContain("calling-llm");
        expect(phases).toContain("done");
      }

      const raw = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      const metadata = bookMetadataSchema.parse(raw);

      expect(metadata.title).toBeTruthy();
      expect(metadata.authors.length).toBeGreaterThan(0);
      expect(metadata.language_code).toBe("en");
    }
  );

  it.skipIf(!hasPagesOnDisk)(
    "cached result matches schema",
    async () => {
      const cacheDir = path.join(booksRoot, "raven", "metadata", ".cache");
      if (!fs.existsSync(cacheDir)) {
        console.warn("No cache directory found — skipping cache validation");
        return;
      }

      const cacheFiles = fs
        .readdirSync(cacheDir)
        .filter((f) => f.endsWith(".json"));
      expect(cacheFiles.length).toBeGreaterThan(0);

      for (const file of cacheFiles) {
        const raw = JSON.parse(
          fs.readFileSync(path.join(cacheDir, file), "utf-8")
        );
        bookMetadataSchema.parse(raw);
      }
    }
  );
});
