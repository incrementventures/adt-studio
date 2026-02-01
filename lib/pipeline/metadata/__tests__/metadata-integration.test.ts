import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { lastValueFrom, toArray } from "rxjs";
import { extractMetadata } from "../metadata";
import { bookMetadataSchema } from "../metadata-schema";
import { closeAllDbs } from "@/lib/db";

const booksRoot = path.resolve("fixtures");
const ravenImagesDir = path.join(booksRoot, "raven", "images");
const hasPagesOnDisk = fs.existsSync(ravenImagesDir);

if (!hasPagesOnDisk) {
  console.warn(
    `Skipping metadata integration tests: ${ravenImagesDir} not found`
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
  });

  it.skipIf(!hasPagesOnDisk)(
    "extracts metadata for raven and validates against schema",
    { timeout: 120_000 },
    async () => {
      // DB already has LLM metadata — isComplete returns immediately
      const progress$ = extractMetadata("raven", { outputRoot: booksRoot });
      const events = await lastValueFrom(progress$.pipe(toArray()));
      expect(events).toEqual([]);

      const metadataPath = path.join(booksRoot, "raven", "metadata", "metadata.json");
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
