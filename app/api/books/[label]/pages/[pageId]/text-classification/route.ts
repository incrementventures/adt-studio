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
  _request: Request,
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

  const current = versions[versions.length - 1];
  const data = getTextClassificationVersion(label, pageId, current);
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
  const { version } = body;

  if (typeof version !== "number") {
    return NextResponse.json(
      { error: "Missing or invalid version" },
      { status: 400 }
    );
  }

  const versions = listTextClassificationVersions(label, pageId);
  if (!versions.includes(version)) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  const data = getTextClassificationVersion(label, pageId, version);
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

  const latest = getLatestTextClassificationPath(label, pageId);
  if (!latest) {
    return NextResponse.json(
      { error: "No text classification found" },
      { status: 404 }
    );
  }

  // Full-data save: client sends the complete edited classification
  if (body.data && typeof body.data === "object") {
    const data: PageTextClassification = body.data;

    const nextVersion = latest.version + 1;
    putNodeData(label, "text-classification", pageId, nextVersion, data);

    return NextResponse.json({ version: nextVersion, ...data });
  }

  // Legacy single-field mutation path
  const { groupIndex, textIndex, textType, text, groupType, isPruned, baseVersion } = body;

  if (typeof groupIndex !== "number") {
    return NextResponse.json(
      { error: "Missing or invalid groupIndex" },
      { status: 400 }
    );
  }

  const hasTextType = typeof textType === "string";
  const hasText = typeof text === "string";
  const hasGroupType = typeof groupType === "string";
  const hasIsPruned = typeof isPruned === "boolean";

  if (!hasTextType && !hasText && !hasGroupType && !hasIsPruned) {
    return NextResponse.json(
      { error: "Must provide textType, text, groupType, or isPruned" },
      { status: 400 }
    );
  }

  if ((hasTextType || hasText || hasIsPruned) && typeof textIndex !== "number") {
    return NextResponse.json(
      { error: "textIndex required for textType/text edits" },
      { status: 400 }
    );
  }

  const bookConfig = loadBookConfig(label);
  const textTypeKeys = Object.keys(bookConfig.text_types);
  const groupTypeKeys = Object.keys(bookConfig.text_group_types);

  if (hasTextType && !textTypeKeys.includes(textType)) {
    return NextResponse.json(
      { error: "Invalid text type" },
      { status: 400 }
    );
  }

  if (hasGroupType && !groupTypeKeys.includes(groupType)) {
    return NextResponse.json(
      { error: "Invalid group type" },
      { status: 400 }
    );
  }

  const sourceVersion =
    typeof baseVersion === "number" ? baseVersion : latest.version;
  const sourceData = getTextClassificationVersion(label, pageId, sourceVersion);
  if (!sourceData) {
    return NextResponse.json(
      { error: "Base version not found" },
      { status: 404 }
    );
  }
  const data: PageTextClassification = JSON.parse(JSON.stringify(sourceData));

  if (groupIndex < 0 || groupIndex >= data.groups.length) {
    return NextResponse.json(
      { error: "groupIndex out of bounds" },
      { status: 400 }
    );
  }

  const group = data.groups[groupIndex];

  if (hasGroupType) {
    group.group_type = groupType;
  }

  if (hasTextType || hasText || hasIsPruned) {
    if (textIndex < 0 || textIndex >= group.texts.length) {
      return NextResponse.json(
        { error: "textIndex out of bounds" },
        { status: 400 }
      );
    }
    if (hasTextType) {
      group.texts[textIndex].text_type = textType;
    }
    if (hasText) {
      group.texts[textIndex].text = text;
    }
    if (hasIsPruned) {
      group.texts[textIndex].is_pruned = isPruned;
    }
  }

  const nextVersion = latest.version + 1;
  putNodeData(label, "text-classification", pageId, nextVersion, data);

  return NextResponse.json({ version: nextVersion, ...data });
}
