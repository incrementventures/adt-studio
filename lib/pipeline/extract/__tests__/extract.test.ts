import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extract } from "../extract.js";
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

    const pagesDir = path.join(tmpDir, "raven", "pages");
    expect(fs.existsSync(pagesDir)).toBe(true);

    // Check first page
    const page001 = path.join(pagesDir, "001");
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
