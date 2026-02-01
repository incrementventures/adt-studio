/**
 * Build fixtures/raven/raven.db from the existing fixture files on disk.
 * Run with: npx tsx fixtures/build-fixture-db.ts
 */
import fs from "node:fs";
import path from "node:path";

const fixturesDir = path.resolve(import.meta.dirname);
const ravenDir = path.join(fixturesDir, "raven");
const dbPath = path.join(ravenDir, "raven.db");

// Remove stale DB files
for (const suffix of ["", "-wal", "-shm"]) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// Set BOOKS_ROOT before importing DB module so getDb() finds the right path
process.env.BOOKS_ROOT = fixturesDir;

// Dynamic imports after env is set
const { getDb, closeAllDbs } = await import("../lib/db");
const { putPageText, putImage, putBookMetadata } = await import("../lib/books");
const { hashBuffer } = await import("../lib/pipeline/llm-log");
const { bookMetadataSchema } = await import("../lib/pipeline/metadata/metadata-schema");

const db = getDb("raven");

// 1. Populate pages table and images from flat images/ dir
const imagesDir = path.join(ravenDir, "images");
const imageFiles = fs.readdirSync(imagesDir).sort();

// Discover page IDs from page images
const pageIds = imageFiles
  .filter((f) => /^pg\d{3}_page\.png$/.test(f))
  .map((f) => f.replace("_page.png", ""))
  .sort();

for (const pageId of pageIds) {
  const pageNumber = parseInt(pageId.slice(2), 10);
  // Text files no longer on disk; insert empty text (tests use DB)
  putPageText("raven", pageId, pageNumber, "");

  // Page image
  const pageImagePath = path.join(imagesDir, `${pageId}_page.png`);
  if (fs.existsSync(pageImagePath)) {
    const buf = fs.readFileSync(pageImagePath);
    putImage(
      "raven",
      `${pageId}_page`,
      pageId,
      `images/${pageId}_page.png`,
      hashBuffer(buf),
      buf.readUInt32BE(16),
      buf.readUInt32BE(20),
      "page"
    );
  }

  // Extracted images
  const re = new RegExp(`^${pageId}_im\\d{3}\\.png$`);
  const extractedImages = imageFiles.filter((f) => re.test(f)).sort();
  for (const imgFile of extractedImages) {
    const imageId = imgFile.replace(/\.png$/, "");
    const buf = fs.readFileSync(path.join(imagesDir, imgFile));
    putImage(
      "raven",
      imageId,
      pageId,
      `images/${imgFile}`,
      hashBuffer(buf),
      buf.readUInt32BE(16),
      buf.readUInt32BE(20),
      "extract"
    );
  }
}

// 2. Populate book_metadata from metadata.json
const metadataPath = path.join(ravenDir, "metadata", "metadata.json");
if (fs.existsSync(metadataPath)) {
  const raw = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  const result = bookMetadataSchema.safeParse(raw);
  if (result.success) {
    putBookMetadata("raven", "llm", result.data);
  } else {
    console.error("metadata.json failed schema validation:", result.error);
  }
}

closeAllDbs();

const stats = fs.statSync(dbPath);
console.log(`Built ${dbPath} (${(stats.size / 1024).toFixed(1)} KB)`);
console.log(`  ${pageIds.length} pages`);
console.log("Done.");
