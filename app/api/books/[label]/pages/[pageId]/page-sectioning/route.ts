import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getBooksRoot,
  getTextClassification,
  getImageClassification,
  loadUnprunedImages,
  resolvePageImagePath,
} from "@/lib/books";
import { loadConfig, getPrunedSectionTypes } from "@/lib/config";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { createContext, resolveModel } from "@/lib/pipeline/node";
import type { LLMProvider } from "@/lib/pipeline/node";
import { sectionPage } from "@/lib/pipeline/page-sectioning/section-page";
import { buildUnprunedGroupSummaries } from "@/lib/pipeline/text-classification/text-classification-schema";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const config = loadConfig();
  const sectionTypes = config.section_types ?? {};
  if (Object.keys(sectionTypes).length === 0) {
    return NextResponse.json(
      { error: "No section_types defined in config" },
      { status: 400 }
    );
  }

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
  const pageImageBase64 = fs.readFileSync(pageImagePath).toString("base64");

  // Load extracted images, filtering out pruned ones
  const images = loadUnprunedImages(label, pageId);

  // Load current text classification
  const extractionResult = getTextClassification(label, pageId);
  if (!extractionResult) {
    return NextResponse.json(
      { error: "No text classification found for this page" },
      { status: 404 }
    );
  }
  const extraction = extractionResult.data;

  // Build groups, excluding pruned text entries
  const groups = buildUnprunedGroupSummaries(extraction, pageId);

  // Resolve model
  const ctx = createContext(label, {
    config,
    outputRoot: booksRoot,
    provider: (config.provider as LLMProvider | undefined) ?? "openai",
  });
  const model = resolveModel(ctx, config.page_sectioning?.model);

  const promptName = config.page_sectioning?.prompt ?? "page_sectioning";
  const sectioningDir = paths.pageSectioningDir;
  fs.mkdirSync(sectioningDir, { recursive: true });

  const sectionTypeList = Object.entries(sectionTypes).map(
    ([key, description]) => ({ key, description })
  );

  const sectioning = await sectionPage({
    model,
    pageImageBase64,
    images,
    groups,
    sectionTypes: sectionTypeList,
    promptName,
    cacheDir: sectioningDir,
  });

  // Mark pruned sections
  const prunedSectionTypes = getPrunedSectionTypes();
  const prunedSet = new Set(prunedSectionTypes);
  for (const s of sectioning.sections) {
    s.is_pruned = prunedSet.has(s.section_type);
  }

  // Record which classification versions were used
  const imageClassResult = getImageClassification(label, pageId);
  sectioning.text_classification_version = extractionResult.version;
  sectioning.image_classification_version = imageClassResult?.version;

  // Write result to disk
  fs.writeFileSync(
    path.join(sectioningDir, `${pageId}.json`),
    JSON.stringify(sectioning, null, 2) + "\n"
  );

  return NextResponse.json(sectioning);
}
