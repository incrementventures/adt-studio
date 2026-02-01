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

// 1. Populate pages table from text.txt files
const pagesDir = path.join(ravenDir, "extract", "pages");
const pageDirs = fs.readdirSync(pagesDir).filter((d) => /^pg\d{3}$/.test(d)).sort();

for (const pageId of pageDirs) {
  const pageNumber = parseInt(pageId.slice(2), 10);
  const textPath = path.join(pagesDir, pageId, "text.txt");
  const text = fs.existsSync(textPath) ? fs.readFileSync(textPath, "utf-8") : "";
  putPageText("raven", pageId, pageNumber, text);

  // Page image
  const pageImagePath = path.join(pagesDir, pageId, "page.png");
  if (fs.existsSync(pageImagePath)) {
    const buf = fs.readFileSync(pageImagePath);
    putImage(
      "raven",
      `${pageId}_page`,
      pageId,
      `extract/pages/${pageId}/page.png`,
      hashBuffer(buf),
      buf.readUInt32BE(16),
      buf.readUInt32BE(20),
      "page"
    );
  }

  // Extracted images
  const imagesDir = path.join(pagesDir, pageId, "images");
  if (fs.existsSync(imagesDir)) {
    const imageFiles = fs.readdirSync(imagesDir).filter((f) => /^pg\d{3}_im\d{3}\.png$/.test(f)).sort();
    for (const imgFile of imageFiles) {
      const imageId = imgFile.replace(/\.png$/, "");
      const buf = fs.readFileSync(path.join(imagesDir, imgFile));
      putImage(
        "raven",
        imageId,
        pageId,
        `extract/pages/${pageId}/images/${imgFile}`,
        hashBuffer(buf),
        buf.readUInt32BE(16),
        buf.readUInt32BE(20),
        "extract"
      );
    }
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
console.log(`  ${pageDirs.length} pages`);

const imgCount = db ? 0 : 0; // DB is closed, just report pages
console.log("Done.");
