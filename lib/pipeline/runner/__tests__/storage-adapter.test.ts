import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { closeAllDbs } from "@/lib/db";
import { putNodeData } from "@/lib/books";
import { createBookStorage } from "../storage-adapter";

// Minimal 1x1 white PNG (67 bytes)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);

function useBooksRoot(dir: string): () => void {
  const prev = process.env.BOOKS_ROOT;
  process.env.BOOKS_ROOT = dir;
  return () => {
    closeAllDbs();
    if (prev === undefined) delete process.env.BOOKS_ROOT;
    else process.env.BOOKS_ROOT = prev;
  };
}

describe("storage-adapter getPageImages", () => {
  const label = "testbook";
  const pageId = "pg001";
  let tmpDir: string;
  let restoreBooksRoot: () => void;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-adapter-test-"));
    const bookDir = path.join(tmpDir, label);
    const imagesDir = path.join(bookDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });

    // Create test image files
    fs.writeFileSync(path.join(imagesDir, "pg001_im001.png"), TINY_PNG);
    fs.writeFileSync(path.join(imagesDir, "pg001_im002.png"), TINY_PNG);
    fs.writeFileSync(path.join(imagesDir, "pg001_im003.png"), TINY_PNG); // cropped image
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

  it("returns empty array when no image classification exists", async () => {
    const storage = createBookStorage(label);
    const images = await storage.getPageImages("pg999");
    expect(images).toEqual([]);
  });

  it("returns images from image classification including crops", async () => {
    // Store image classification with both extracted and cropped images
    const classification = {
      images: [
        { image_id: "pg001_im001", path: "images/pg001_im001.png", is_pruned: false },
        { image_id: "pg001_im002", path: "images/pg001_im002.png", is_pruned: true },
        { image_id: "pg001_im003", path: "images/pg001_im003.png", is_pruned: false }, // crop
      ],
    };
    putNodeData(label, "image-classification", pageId, 1, classification);

    const storage = createBookStorage(label);
    const images = await storage.getPageImages(pageId);

    // Should return all images from classification (pruning is handled elsewhere)
    expect(images).toHaveLength(3);
    expect(images.map((i) => i.imageId)).toEqual([
      "pg001_im001",
      "pg001_im002",
      "pg001_im003",
    ]);
  });

  it("uses latest version of image classification", async () => {
    // v1: only extracted images
    putNodeData(label, "image-classification", "pg002", 1, {
      images: [
        { image_id: "pg001_im001", path: "images/pg001_im001.png", is_pruned: false },
      ],
    });

    // v2: adds a cropped image
    putNodeData(label, "image-classification", "pg002", 2, {
      images: [
        { image_id: "pg001_im001", path: "images/pg001_im001.png", is_pruned: false },
        { image_id: "pg001_im003", path: "images/pg001_im003.png", is_pruned: false },
      ],
    });

    const storage = createBookStorage(label);
    const images = await storage.getPageImages("pg002");

    // Should use v2 with both images
    expect(images).toHaveLength(2);
    expect(images.map((i) => i.imageId)).toEqual(["pg001_im001", "pg001_im003"]);
  });

  it("skips images where file does not exist", async () => {
    putNodeData(label, "image-classification", "pg003", 1, {
      images: [
        { image_id: "pg001_im001", path: "images/pg001_im001.png", is_pruned: false },
        { image_id: "missing", path: "images/missing.png", is_pruned: false },
      ],
    });

    const storage = createBookStorage(label);
    const images = await storage.getPageImages("pg003");

    expect(images).toHaveLength(1);
    expect(images[0].imageId).toBe("pg001_im001");
  });
});
