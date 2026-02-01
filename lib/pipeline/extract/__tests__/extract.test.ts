import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extract } from "../extract";
import { lastValueFrom, toArray } from "rxjs";

describe("extract", () => {
  const fixtureDir = path.resolve("assets");
  const pdfPath = path.join(fixtureDir, "raven.pdf");
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-test-"));
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

    const pagesDir = path.join(tmpDir, "raven", "extract", "pages");
    expect(fs.existsSync(pagesDir)).toBe(true);

    // Check first page
    const page001 = path.join(pagesDir, "pg001");
    expect(fs.existsSync(path.join(page001, "page.png"))).toBe(true);
    expect(fs.existsSync(path.join(page001, "text.txt"))).toBe(true);

    // page.png should be a valid PNG (starts with PNG magic bytes)
    const png = fs.readFileSync(path.join(page001, "page.png"));
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // P
    expect(png[2]).toBe(0x4e); // N
    expect(png[3]).toBe(0x47); // G

    // text.txt should have some content
    const text = fs.readFileSync(path.join(page001, "text.txt"), "utf-8");
    expect(text.length).toBeGreaterThan(0);

    // Embedded images should be extracted
    const imagesDir = path.join(page001, "images");
    expect(fs.existsSync(imagesDir)).toBe(true);
    const images = fs.readdirSync(imagesDir);
    expect(images.length).toBeGreaterThan(0);

    // Each extracted image should be a valid PNG
    const imgPng = fs.readFileSync(path.join(imagesDir, images[0]));
    expect(imgPng[0]).toBe(0x89);
    expect(imgPng[1]).toBe(0x50);

    // PDF metadata should be extracted
    const metadataPath = path.join(tmpDir, "raven", "extract", "metadata.json");
    expect(fs.existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
    expect(metadata).toBeTypeOf("object");
    expect(metadata.format).toMatch(/^PDF \d/);
    expect(metadata.title).toBe("Hyena and Raven");
  });

  describe("page ranges", () => {
    it("extracts only the requested range (startPage + endPage)", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-range-"));
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: 2, endPage: 4 }).pipe(toArray())
        );

        // Should report 3 pages of progress
        expect(progress.length).toBe(3);
        expect(progress[0]).toEqual({ page: 1, totalPages: 3, label: "raven" });
        expect(progress[2]).toEqual({ page: 3, totalPages: 3, label: "raven" });

        const pagesDir = path.join(dir, "raven", "extract", "pages");
        const dirs = fs.readdirSync(pagesDir).sort();
        expect(dirs).toEqual(["pg002", "pg003", "pg004"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("extracts from startPage to end when endPage is omitted", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-start-"));
      try {
        // Get total page count first
        const allProgress = await lastValueFrom(
          extract(pdfPath, fs.mkdtempSync(path.join(os.tmpdir(), "extract-all-"))).pipe(toArray())
        );
        const totalPages = allProgress[0].totalPages;

        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: totalPages - 1 }).pipe(toArray())
        );

        // Should extract only the last 2 pages
        expect(progress.length).toBe(2);
        expect(progress[0].totalPages).toBe(2);

        const pagesDir = path.join(dir, "raven", "extract", "pages");
        const dirs = fs.readdirSync(pagesDir).sort();
        expect(dirs.length).toBe(2);
        // First dir should be the (totalPages-1)-th page
        const expectedFirst = "pg" + String(totalPages - 1).padStart(3, "0");
        expect(dirs[0]).toBe(expectedFirst);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("extracts from page 1 to endPage when startPage is omitted", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-end-"));
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { endPage: 3 }).pipe(toArray())
        );

        expect(progress.length).toBe(3);
        expect(progress[0]).toEqual({ page: 1, totalPages: 3, label: "raven" });
        expect(progress[2]).toEqual({ page: 3, totalPages: 3, label: "raven" });

        const pagesDir = path.join(dir, "raven", "extract", "pages");
        const dirs = fs.readdirSync(pagesDir).sort();
        expect(dirs).toEqual(["pg001", "pg002", "pg003"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("clamps endPage to total pages when it exceeds document length", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-clamp-"));
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: 1, endPage: 9999 }).pipe(toArray())
        );

        // Should extract all pages without error
        expect(progress.length).toBeGreaterThan(0);
        // totalPages should be the actual page count, not 9999
        expect(progress[0].totalPages).toBeLessThan(9999);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("extracts a single page when startPage equals endPage", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-single-"));
      try {
        const progress = await lastValueFrom(
          extract(pdfPath, dir, { startPage: 3, endPage: 3 }).pipe(toArray())
        );

        expect(progress.length).toBe(1);
        expect(progress[0]).toEqual({ page: 1, totalPages: 1, label: "raven" });

        const pagesDir = path.join(dir, "raven", "extract", "pages");
        const dirs = fs.readdirSync(pagesDir);
        expect(dirs).toEqual(["pg003"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("extracts images nested inside Form XObjects (page range)", async () => {
    const egyptPdf = path.join(fixtureDir, "ancient_egypt.pdf");
    const egyptDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-egypt-"));

    try {
      const progress = await lastValueFrom(
        extract(egyptPdf, egyptDir, { startPage: 6, endPage: 6 }).pipe(toArray())
      );

      // Only 1 page extracted
      expect(progress.length).toBe(1);
      expect(progress[0].totalPages).toBe(1);

      const pagesDir = path.join(egyptDir, "ancient-egypt", "extract", "pages");

      // pg006 should exist with images
      const pg006Images = path.join(pagesDir, "pg006", "images");
      expect(fs.existsSync(pg006Images)).toBe(true);
      const images = fs.readdirSync(pg006Images).filter((f) =>
        f.endsWith(".png")
      );
      expect(images.length).toBeGreaterThanOrEqual(1);

      // Verify extracted image is a valid PNG
      const imgPng = fs.readFileSync(path.join(pg006Images, images[0]));
      expect(imgPng[0]).toBe(0x89);
      expect(imgPng[1]).toBe(0x50);

      // Pages outside range should not exist
      expect(fs.existsSync(path.join(pagesDir, "pg005"))).toBe(false);
      expect(fs.existsSync(path.join(pagesDir, "pg007"))).toBe(false);
    } finally {
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
