import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getBooksRoot,
  getBookMetadata,
  getLatestTextClassificationPath,
  getTextClassificationVersion,
  listTextClassificationVersions,
  getCurrentTextClassificationVersion,
  setCurrentTextClassificationVersion,
  resolvePageImagePath,
  getPage,
  type PageTextClassification,
} from "@/lib/books";
import { loadConfig, textTypeKeys, groupTypeKeys, getTextTypes, getTextGroupTypes, getPrunedTextTypes } from "@/lib/config";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { createContext, resolveModel } from "@/lib/pipeline/node";
import type { LLMProvider } from "@/lib/pipeline/node";
import { classifyPage } from "@/lib/pipeline/text-classification/classify-page";

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

  const current = getCurrentTextClassificationVersion(label, pageId);
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

  const config = loadConfig();
  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);

  // Load page image
  const pageImagePath = resolvePageImagePath(label, pageId);
  if (!fs.existsSync(pageImagePath)) {
    return NextResponse.json(
      { error: "Page image not found" },
      { status: 404 }
    );
  }
  const imageBase64 = fs.readFileSync(pageImagePath).toString("base64");

  // Load page text
  const page = getPage(label, pageId);
  if (!page) {
    return NextResponse.json(
      { error: "Page not found" },
      { status: 404 }
    );
  }

  // Get language from metadata
  const metadata = getBookMetadata(label);
  const language = metadata?.language_code ?? "en";

  // Resolve model
  const ctx = createContext(label, {
    config,
    outputRoot: booksRoot,
    provider: (config.provider as LLMProvider | undefined) ?? "openai",
  });
  const model = resolveModel(ctx, config.text_classification?.model);

  const promptName = config.text_classification?.prompt ?? "text_classification";
  const textClassificationDir = paths.textClassificationDir;
  fs.mkdirSync(textClassificationDir, { recursive: true });

  const textTypes = Object.entries(getTextTypes()).map(
    ([key, description]) => ({ key, description })
  );
  const textGroupTypes = Object.entries(getTextGroupTypes()).map(
    ([key, description]) => ({ key, description })
  );

  // Parse page number from pageId (pg001 -> 1)
  const pageNumber = parseInt(pageId.replace("pg", ""), 10);

  const classification = await classifyPage({
    model,
    pageNumber,
    pageId,
    text: page.rawText,
    imageBase64,
    language,
    textTypes,
    textGroupTypes,
    prunedTextTypes: getPrunedTextTypes(),
    promptName,
    cacheDir: textClassificationDir,
  });

  // Write result to disk as the base file (overwrites previous)
  fs.writeFileSync(
    path.join(textClassificationDir, `${pageId}.json`),
    JSON.stringify(classification, null, 2) + "\n"
  );

  // Reset version tracking — remove versioned files and current pointer
  for (const f of fs.readdirSync(textClassificationDir)) {
    if (f.startsWith(`${pageId}.v`) || f === `${pageId}.current`) {
      fs.unlinkSync(path.join(textClassificationDir, f));
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

  const versions = listTextClassificationVersions(label, pageId);
  if (!versions.includes(version)) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  setCurrentTextClassificationVersion(label, pageId, version);

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
    const paths = resolveBookPaths(label, getBooksRoot());
    const newFile = path.join(
      paths.textClassificationDir,
      `${pageId}.v${String(nextVersion).padStart(3, "0")}.json`
    );

    fs.writeFileSync(newFile, JSON.stringify(data, null, 2), "utf-8");
    setCurrentTextClassificationVersion(label, pageId, nextVersion);

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
  const paths = resolveBookPaths(label, getBooksRoot());
  const newFile = path.join(
    paths.textClassificationDir,
    `${pageId}.v${String(nextVersion).padStart(3, "0")}.json`
  );

  fs.writeFileSync(newFile, JSON.stringify(data, null, 2), "utf-8");
  setCurrentTextClassificationVersion(label, pageId, nextVersion);

  return NextResponse.json({ version: nextVersion, ...data });
}
