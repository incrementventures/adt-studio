import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extract } from "../extract";
import { getDb } from "@/lib/db";
import { closeAllDbs } from "@/lib/db";
import { getPdfMetadata } from "@/lib/books";
import { lastValueFrom, toArray } from "rxjs";

/**
 * Set BOOKS_ROOT so that getDb() and extract() agree on the DB location.
 * Returns a cleanup function that restores the previous value.
 */
function useBooksRoot(dir: string): () => void {
  const prev = process.env.BOOKS_ROOT;
  process.env.BOOKS_ROOT = dir;
  return () => {
    closeAllDbs();
    if (prev === undefined) delete process.env.BOOKS_ROOT;
    else process.env.BOOKS_ROOT = prev;
  };
}

describe("extract", () => {
  const fixtureDir = path.resolve("assets");
  const pdfPath = path.join(fixtureDir, "raven.pdf");
  let tmpDir: string;
  let restoreBooksRoot: () => void;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-test-"));
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

  it("extracts pages with page images and text", async () => {
    const progress = await lastValueFrom(
      extract(pdfPath, tmpDir).pipe(toArray())
    );

    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0].label).toBe("raven");
    expect(progress[0].page).toBe(1);

    const imagesDir = path.join(tmpDir, "raven", "images");
    expect(fs.existsSync(imagesDir)).toBe(true);

    // Check first page image
    expect(fs.existsSync(path.join(imagesDir, "pg001_page.png"))).toBe(true);

    // page.png should be a valid PNG (starts with PNG magic bytes)
    const png = fs.readFileSync(path.join(imagesDir, "pg001_page.png"));
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // P
    expect(png[2]).toBe(0x4e); // N
    expect(png[3]).toBe(0x47); // G

    // Text should be stored in DB
    const db = getDb("raven");
    const row = db
      .prepare("SELECT text FROM pages WHERE page_id = ?")
      .get("pg001") as { text: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.text.length).toBeGreaterThan(0);

    // Embedded images should be extracted to flat images/ dir
    const images = fs.readdirSync(imagesDir).filter((f) => /^pg001_im\d{3}\.png$/.test(f));
    expect(images.length).toBeGreaterThan(0);

    // Each extracted image should be a valid PNG
    const imgPng = fs.readFileSync(path.join(imagesDir, images[0]));
    expect(imgPng[0]).toBe(0x89);
    expect(imgPng[1]).toBe(0x50);

    // PDF metadata should be stored in DB
    const metadata = getPdfMetadata("raven");
    expect(metadata).toBeDefined();
    expect(metadata!.format).toMatch(/^PDF \d/);
    expect(metadata!.title).toBe("Hyena and Raven");

    // Image hashes should be stored in DB
    const imgRow = db
      .prepare("SELECT hash FROM images WHERE image_id = ?")
      .get("pg001_page") as { hash: string } | undefined;
    expect(imgRow).toBeDefined();
    expect(imgRow!.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  describe("page ranges", () => {
    it("extracts only the requested range (startPage + endPage)", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-range-"));
      const restore = useBooksRoot(dir);
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: 2, endPage: 4 }).pipe(toArray())
        );

        // Should report 3 pages of progress
        expect(progress.length).toBe(3);
        expect(progress[0]).toEqual({ page: 1, totalPages: 3, label: "raven" });
        expect(progress[2]).toEqual({ page: 3, totalPages: 3, label: "raven" });

        const imagesDir = path.join(dir, "raven", "images");
        const pageImages = fs.readdirSync(imagesDir).filter((f) => /^pg\d{3}_page\.png$/.test(f)).sort();
        expect(pageImages).toEqual(["pg002_page.png", "pg003_page.png", "pg004_page.png"]);
      } finally {
        restore();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("extracts from startPage to end when endPage is omitted", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-start-"));
      const restore = useBooksRoot(dir);
      try {
        // Get total page count first
        const allDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-all-"));
        const restoreAll = useBooksRoot(allDir);
        const allProgress = await lastValueFrom(
          extract(pdfPath, allDir).pipe(toArray())
        );
        const totalPages = allProgress[0].totalPages;
        restoreAll();

        const restoreMain = useBooksRoot(dir);
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: totalPages - 1 }).pipe(toArray())
        );

        // Should extract only the last 2 pages
        expect(progress.length).toBe(2);
        expect(progress[0].totalPages).toBe(2);

        const imagesDir = path.join(dir, "raven", "images");
        const pageImages = fs.readdirSync(imagesDir).filter((f) => /^pg\d{3}_page\.png$/.test(f)).sort();
        expect(pageImages.length).toBe(2);
        // First image should be the (totalPages-1)-th page
        const expectedFirst = "pg" + String(totalPages - 1).padStart(3, "0") + "_page.png";
        expect(pageImages[0]).toBe(expectedFirst);
        restoreMain();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("extracts from page 1 to endPage when startPage is omitted", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-end-"));
      const restore = useBooksRoot(dir);
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { endPage: 3 }).pipe(toArray())
        );

        expect(progress.length).toBe(3);
        expect(progress[0]).toEqual({ page: 1, totalPages: 3, label: "raven" });
        expect(progress[2]).toEqual({ page: 3, totalPages: 3, label: "raven" });

        const imagesDir = path.join(dir, "raven", "images");
        const pageImages = fs.readdirSync(imagesDir).filter((f) => /^pg\d{3}_page\.png$/.test(f)).sort();
        expect(pageImages).toEqual(["pg001_page.png", "pg002_page.png", "pg003_page.png"]);
      } finally {
        restore();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("clamps endPage to total pages when it exceeds document length", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-clamp-"));
      const restore = useBooksRoot(dir);
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: 1, endPage: 9999 }).pipe(toArray())
        );

        // Should extract all pages without error
        expect(progress.length).toBeGreaterThan(0);
        // totalPages should be the actual page count, not 9999
        expect(progress[0].totalPages).toBeLessThan(9999);
      } finally {
        restore();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("extracts a single page when startPage equals endPage", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-single-"));
      const restore = useBooksRoot(dir);
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: 3, endPage: 3 }).pipe(toArray())
        );

        expect(progress.length).toBe(1);
        expect(progress[0]).toEqual({ page: 1, totalPages: 1, label: "raven" });

        const imagesDir = path.join(dir, "raven", "images");
        const pageImages = fs.readdirSync(imagesDir).filter((f) => /^pg\d{3}_page\.png$/.test(f));
        expect(pageImages).toEqual(["pg003_page.png"]);
      } finally {
        restore();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("extracts images nested inside Form XObjects (page range)", async () => {
    const egyptPdf = path.join(fixtureDir, "ancient_egypt.pdf");
    const egyptDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-egypt-"));
    const restore = useBooksRoot(egyptDir);

    try {
      const progress = await lastValueFrom(
        extract(egyptPdf, egyptDir, { startPage: 6, endPage: 6 }).pipe(toArray())
      );

      // Only 1 page extracted
      expect(progress.length).toBe(1);
      expect(progress[0].totalPages).toBe(1);

      const imagesDir = path.join(egyptDir, "ancient-egypt", "images");

      // pg006 page image should exist
      expect(fs.existsSync(path.join(imagesDir, "pg006_page.png"))).toBe(true);

      // pg006 should have extracted images
      const images = fs.readdirSync(imagesDir).filter((f) =>
        /^pg006_im\d{3}\.png$/.test(f)
      );
      expect(images.length).toBeGreaterThanOrEqual(1);

      // Verify extracted image is a valid PNG
      const imgPng = fs.readFileSync(path.join(imagesDir, images[0]));
      expect(imgPng[0]).toBe(0x89);
      expect(imgPng[1]).toBe(0x50);

      // Pages outside range should not exist
      expect(fs.existsSync(path.join(imagesDir, "pg005_page.png"))).toBe(false);
      expect(fs.existsSync(path.join(imagesDir, "pg007_page.png"))).toBe(false);
    } finally {
      restore();
      fs.rmSync(egyptDir, { recursive: true, force: true });
    }
  });

  it("emits progress for every page", async () => {
    const progress = await lastValueFrom(
      extract(pdfPath, tmpDir).pipe(toArray())
    );

    const totalPages = progress[0].totalPages;
    expect(progress.length).toBe(totalPages);

    for (let i = 0; i < progress.length; i++) {
      expect(progress[i].page).toBe(i + 1);
      expect(progress[i].totalPages).toBe(totalPages);
    }
  });
});
