import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  getBooksRoot,
  getPage,
  listImageClassificationVersions,
  getImageClassificationVersion,
  getCurrentImageClassificationVersion,
  setCurrentImageClassificationVersion,
  getLatestImageClassificationPath,
} from "@/lib/books";
import type { PageImageClassification } from "@/lib/pipeline/image-classification/image-classification-schema";
import { loadBookConfig, getImageFilters } from "@/lib/config";
import { resolveBookPaths } from "@/lib/pipeline/types";
import {
  classifyPageImages,
  type ImageInput,
} from "@/lib/pipeline/image-classification/classify-page-images";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const versions = listImageClassificationVersions(label, pageId);
  if (versions.length === 0) {
    return NextResponse.json(
      { error: "No image classification found" },
      { status: 404 }
    );
  }

  const current = getCurrentImageClassificationVersion(label, pageId);
  const data = getImageClassificationVersion(label, pageId, current);
  if (!data) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ versions, current, data });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);

  const page = getPage(label, pageId);
  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  // Discover extracted images
  const imagesDir = path.join(paths.pagesDir, pageId, "images");
  const imageInputs: ImageInput[] = [];
  if (fs.existsSync(imagesDir)) {
    const imageFiles = fs
      .readdirSync(imagesDir)
      .filter((f) => /^pg\d{3}_im\d{3}\.png$/i.test(f))
      .sort();
    for (const imgFile of imageFiles) {
      const imageId = imgFile.replace(/\.png$/i, "");
      const buf = fs.readFileSync(path.join(imagesDir, imgFile));
      imageInputs.push({
        image_id: imageId,
        path: `extract/pages/${pageId}/images/${imgFile}`,
        buf,
      });
    }
  }

  const sizeFilter = getImageFilters(loadBookConfig(label)).size;
  const classification = classifyPageImages(imageInputs, sizeFilter);

  // Prepend the full page image as a pruned entry (available for cropping)
  const pageImagePath = path.join(paths.pagesDir, pageId, "page.png");
  if (fs.existsSync(pageImagePath)) {
    const pageBuf = fs.readFileSync(pageImagePath);
    const pageWidth = pageBuf.readUInt32BE(16);
    const pageHeight = pageBuf.readUInt32BE(20);
    classification.images.unshift({
      image_id: `${pageId}_im000`,
      path: `extract/pages/${pageId}/page.png`,
      width: pageWidth,
      height: pageHeight,
      is_pruned: true,
    });
  }

  // Write to disk as base file (overwrites previous)
  fs.mkdirSync(paths.imageClassificationDir, { recursive: true });
  fs.writeFileSync(
    path.join(paths.imageClassificationDir, `${pageId}.json`),
    JSON.stringify(classification, null, 2) + "\n"
  );

  // Reset version tracking — remove versioned files and current pointer
  for (const f of fs.readdirSync(paths.imageClassificationDir)) {
    if (f.startsWith(`${pageId}.v`) || f === `${pageId}.current`) {
      fs.unlinkSync(path.join(paths.imageClassificationDir, f));
    }
  }

  return NextResponse.json({ version: 1, ...classification });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const body = await request.json();
  const { version } = body;

  if (typeof version !== "number") {
    return NextResponse.json(
      { error: "Missing or invalid version" },
      { status: 400 }
    );
  }

  const versions = listImageClassificationVersions(label, pageId);
  if (!versions.includes(version)) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  setCurrentImageClassificationVersion(label, pageId, version);

  const data = getImageClassificationVersion(label, pageId, version);
  return NextResponse.json({ versions, current: version, data });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const body = await request.json();

  const latest = getLatestImageClassificationPath(label, pageId);
  if (!latest) {
    return NextResponse.json(
      { error: "No image classification found" },
      { status: 404 }
    );
  }

  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json(
      { error: "Missing data" },
      { status: 400 }
    );
  }

  const data: PageImageClassification = body.data;
  const nextVersion = latest.version + 1;
  const paths = resolveBookPaths(label, getBooksRoot());
  const imagesDir = path.join(paths.pagesDir, pageId, "images");
  const classDir = paths.imageClassificationDir;
  fs.mkdirSync(classDir, { recursive: true });

  // Scan both imagesDir and imageClassificationDir for max _imNNN number
  const imNumRe = new RegExp(`^${pageId}_im(\\d{3})\\.png$`);
  let maxNum = 0;
  for (const dir of [imagesDir, classDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = imNumRe.exec(f);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
  }

  // Assign final IDs and generate crop files for entries with source_region
  for (const img of data.images) {
    if (!img.source_region || !img.source_image_id) continue;
    const croppedPath = path.join(classDir, `${img.image_id}.png`);
    if (fs.existsSync(croppedPath)) continue;

    // Assign next available _imNNN ID
    maxNum++;
    const newId = `${pageId}_im${String(maxNum).padStart(3, "0")}`;
    img.image_id = newId;
    img.path = `image-classification/${newId}.png`;

    // Resolve source image via its entry's path
    const sourceEntry = data.images.find((e) => e.image_id === img.source_image_id);
    if (!sourceEntry) continue;
    const originalPath = path.join(paths.bookDir, sourceEntry.path);
    if (!fs.existsSync(originalPath)) continue;
    const buf = fs.readFileSync(originalPath);
    const { x, y, width, height } = img.source_region;
    await sharp(buf)
      .extract({ left: x, top: y, width, height })
      .toFile(path.join(classDir, `${newId}.png`));
  }

  // Write versioned JSON with canonical IDs
  const newFile = path.join(
    classDir,
    `${pageId}.v${String(nextVersion).padStart(3, "0")}.json`
  );
  fs.writeFileSync(newFile, JSON.stringify(data, null, 2), "utf-8");
  setCurrentImageClassificationVersion(label, pageId, nextVersion);

  return NextResponse.json({ version: nextVersion, ...data });
}
