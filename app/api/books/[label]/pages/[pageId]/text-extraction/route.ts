import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getBooksRoot,
  getLatestTextExtractionPath,
  getTextExtractionVersion,
  listTextExtractionVersions,
  getCurrentTextExtractionVersion,
  setCurrentTextExtractionVersion,
  type PageTextExtraction,
} from "@/lib/books";
import { textTypeKeys, groupTypeKeys } from "@/lib/config";
import { resolveBookPaths } from "@/lib/pipeline/types";

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

  const versions = listTextExtractionVersions(label, pageId);
  if (versions.length === 0) {
    return NextResponse.json(
      { error: "No text extraction found" },
      { status: 404 }
    );
  }

  const current = getCurrentTextExtractionVersion(label, pageId);
  const data = getTextExtractionVersion(label, pageId, current);
  if (!data) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ versions, current, data });
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

  const versions = listTextExtractionVersions(label, pageId);
  if (!versions.includes(version)) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  setCurrentTextExtractionVersion(label, pageId, version);

  const data = getTextExtractionVersion(label, pageId, version);
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
  const { groupIndex, textIndex, textType, text, groupType, baseVersion } = body;

  if (typeof groupIndex !== "number") {
    return NextResponse.json(
      { error: "Missing or invalid groupIndex" },
      { status: 400 }
    );
  }

  // Must provide exactly one mutation
  const hasTextType = typeof textType === "string";
  const hasText = typeof text === "string";
  const hasGroupType = typeof groupType === "string";

  if (!hasTextType && !hasText && !hasGroupType) {
    return NextResponse.json(
      { error: "Must provide textType, text, or groupType" },
      { status: 400 }
    );
  }

  // textType and text require textIndex
  if ((hasTextType || hasText) && typeof textIndex !== "number") {
    return NextResponse.json(
      { error: "textIndex required for textType/text edits" },
      { status: 400 }
    );
  }

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

  const latest = getLatestTextExtractionPath(label, pageId);
  if (!latest) {
    return NextResponse.json(
      { error: "No text extraction found" },
      { status: 404 }
    );
  }

  // Load data from the version being edited (baseVersion), not necessarily latest
  const sourceVersion =
    typeof baseVersion === "number" ? baseVersion : latest.version;
  const sourceData = getTextExtractionVersion(label, pageId, sourceVersion);
  if (!sourceData) {
    return NextResponse.json(
      { error: "Base version not found" },
      { status: 404 }
    );
  }
  const data: PageTextExtraction = JSON.parse(JSON.stringify(sourceData));

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

  if (hasTextType || hasText) {
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
  }

  const nextVersion = latest.version + 1;
  const paths = resolveBookPaths(label, getBooksRoot());
  const newFile = path.join(
    paths.textExtractionDir,
    `${pageId}.v${String(nextVersion).padStart(3, "0")}.json`
  );

  fs.writeFileSync(newFile, JSON.stringify(data, null, 2), "utf-8");
  setCurrentTextExtractionVersion(label, pageId, nextVersion);

  return NextResponse.json({ version: nextVersion, ...data });
}
