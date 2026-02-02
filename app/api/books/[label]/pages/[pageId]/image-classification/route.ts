import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  getBooksRoot,
  getPage,
  getMaxImageNum,
  getImageHashes,
  listImageClassificationVersions,
  getImageClassificationVersion,
  getLatestImageClassificationPath,
  putNodeData,
  putImage,
} from "@/lib/books";
import type { PageImageClassification } from "@/lib/pipeline/image-classification/image-classification-schema";
import { hashBuffer } from "@/lib/pipeline/llm-log";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { queue } from "@/lib/queue";

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

  const current = versions[versions.length - 1];
  const data = getImageClassificationVersion(label, pageId, current);
  if (!data) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  const imageHashes = getImageHashes(label, pageId);
  return NextResponse.json({ versions, current, data, imageHashes });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  if (!getPage(label, pageId)) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  const jobId = queue.enqueue("image-classification", label, { pageId });
  return NextResponse.json({ jobId });
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

  const data = getImageClassificationVersion(label, pageId, version);
  const imageHashes = getImageHashes(label, pageId);
  return NextResponse.json({ versions, current: version, data, imageHashes });
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
  const imagesDir = paths.imagesDir;
  fs.mkdirSync(imagesDir, { recursive: true });

  let maxNum = getMaxImageNum(label, pageId);

  // Assign final IDs and generate crop files for entries with source_region
  for (const img of data.images) {
    if (!img.source_region || !img.source_image_id) continue;
    const croppedPath = path.join(imagesDir, `${img.image_id}.png`);
    if (fs.existsSync(croppedPath)) continue;

    // Assign next available _imNNN ID
    maxNum++;
    const newId = `${pageId}_im${String(maxNum).padStart(3, "0")}`;
    img.image_id = newId;
    img.path = `images/${newId}.png`;

    // Resolve source image via its entry's path
    const sourceEntry = data.images.find((e) => e.image_id === img.source_image_id);
    if (!sourceEntry) continue;
    const originalPath = path.join(paths.bookDir, sourceEntry.path);
    if (!fs.existsSync(originalPath)) continue;
    const buf = fs.readFileSync(originalPath);
    const { x, y, width, height } = img.source_region;
    await sharp(buf)
      .extract({ left: x, top: y, width, height })
      .toFile(path.join(imagesDir, `${newId}.png`));
    const cropBuf = fs.readFileSync(path.join(imagesDir, `${newId}.png`));
    putImage(label, newId, pageId, `images/${newId}.png`, hashBuffer(cropBuf), width, height, "crop");
  }

  // Write versioned data to DB
  putNodeData(label, "image-classification", pageId, nextVersion, data);

  const imageHashes = getImageHashes(label, pageId);
  const versions = listImageClassificationVersions(label, pageId);
  return NextResponse.json({ version: nextVersion, versions, imageHashes, ...data });
}
