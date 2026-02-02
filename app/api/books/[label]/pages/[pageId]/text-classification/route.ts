import { NextResponse } from "next/server";
import fs from "node:fs";
import {
  getLatestTextClassificationPath,
  getTextClassificationVersion,
  listTextClassificationVersions,
  resolvePageImagePath,
  getPage,
  putNodeData,
  type PageTextClassification,
} from "@/lib/books";
import { loadBookConfig } from "@/lib/config";
import { queue } from "@/lib/queue";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const versions = listTextClassificationVersions(label, pageId);
  if (versions.length === 0) {
    return NextResponse.json(
      { error: "No text classification found" },
      { status: 404 }
    );
  }

  const url = new URL(request.url);
  const vParam = url.searchParams.get("version");
  const version = vParam ? Number(vParam) : versions[versions.length - 1];

  if (!versions.includes(version)) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  const data = getTextClassificationVersion(label, pageId, version);
  if (!data) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ versions, version, data });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  // Validate prerequisites
  const pageImagePath = resolvePageImagePath(label, pageId);
  if (!fs.existsSync(pageImagePath)) {
    return NextResponse.json(
      { error: "Page image not found" },
      { status: 404 }
    );
  }

  if (!getPage(label, pageId)) {
    return NextResponse.json(
      { error: "Page not found" },
      { status: 404 }
    );
  }

  const jobId = queue.enqueue("text-classification", label, { pageId });
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

  const latest = getLatestTextClassificationPath(label, pageId);
  if (!latest) {
    return NextResponse.json(
      { error: "No text classification found" },
      { status: 404 }
    );
  }

  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json(
      { error: "Missing data" },
      { status: 400 }
    );
  }

  const data: PageTextClassification = body.data;
  const nextVersion = latest.version + 1;
  putNodeData(label, "text-classification", pageId, nextVersion, data);

  return NextResponse.json({ version: nextVersion, versions: listTextClassificationVersions(label, pageId), data });
}
