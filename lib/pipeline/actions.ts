/**
 * Single-page pipeline actions.
 *
 * Each function encapsulates the full workflow for one page:
 *   load config → resolve model → read data → call LLM → write results.
 *
 * Used by the job-queue executors and can be called directly for testing.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getBookMetadata,
  getBooksRoot,
  getTextClassification,
  getImageClassification,
  getPageSectioning,
  getExtractedImages,
  loadUnprunedImages,
  resolvePageImagePath,
  getPage,
  getWebRenderingVersion,
  listWebRenderingVersions,
  putNodeData,
  resetNodeVersions,
} from "@/lib/books";
import { getDb } from "@/lib/db";
import {
  loadBookConfig,
  getImageFilters,
  getPrunedSectionTypes,
  getPrunedTextTypes,
  getTextTypes,
  getTextGroupTypes,
} from "@/lib/config";

import { resolveBookPaths } from "@/lib/pipeline/types";
import { createContext, resolveModel } from "@/lib/pipeline/node";
import type { LLMProvider } from "@/lib/pipeline/node";
import {
  renderSection,
  type RenderSectionText,
  type RenderSectionImage,
} from "@/lib/pipeline/web-rendering/render-section";
import type { SectionRendering } from "@/lib/pipeline/web-rendering/web-rendering-schema";
import { editSection, type Annotation } from "@/lib/pipeline/web-rendering/edit-section";
import { classifyPage } from "@/lib/pipeline/text-classification/classify-page";
import { buildLlmTextClassificationSchema } from "@/lib/pipeline/text-classification/text-classification-schema";
import { sectionPage } from "@/lib/pipeline/page-sectioning/section-page";
import { buildUnprunedGroupSummaries } from "@/lib/pipeline/text-classification/text-classification-schema";
import {
  classifyPageImages,
  type ImageInput,
} from "@/lib/pipeline/image-classification/classify-page-images";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveCtx(label: string) {
  const config = loadBookConfig(label);
  const booksRoot = getBooksRoot();
  const ctx = createContext(label, {
    config,
    outputRoot: booksRoot,
    provider: (config.provider as LLMProvider | undefined) ?? "openai",
  });
  return { config, booksRoot, ctx };
}

/** Build the text-id lookup that web-rendering and web-edit both need. */
function buildTextLookup(
  label: string,
  pageId: string
): {
  textLookup: Map<string, RenderSectionText[]>;
  imageMap: Map<string, string>;
} {
  const extractionResult = getTextClassification(label, pageId);
  if (!extractionResult) throw new Error("No text classification found");
  const extraction = extractionResult.data;

  const textLookup = new Map<string, RenderSectionText[]>();
  extraction.groups.forEach((g, idx) => {
    const groupId =
      g.group_id ?? pageId + "_gp" + String(idx + 1).padStart(3, "0");
    const texts: RenderSectionText[] = [];
    g.texts.forEach((t, ti) => {
      if (t.is_pruned) return;
      texts.push({
        text_id: groupId + "_t" + String(ti + 1).padStart(3, "0"),
        text_type: t.text_type,
        text: t.text,
      });
    });
    if (texts.length > 0) {
      textLookup.set(groupId, texts);
    }
  });

  const allImages = loadUnprunedImages(label, pageId);
  const imageMap = new Map(
    allImages.map((img) => [img.image_id, img.imageBase64])
  );

  return { textLookup, imageMap };
}

// ---------------------------------------------------------------------------
// Web rendering — render all sections for one page
// ---------------------------------------------------------------------------

export interface WebRenderingResult {
  sections: (SectionRendering & { version: number; versions: number[] })[];
}

export async function runWebRendering(
  label: string,
  pageId: string,
  onProgress?: (message: string) => void
): Promise<WebRenderingResult> {
  const { config, ctx } = resolveCtx(label);
  const model = resolveModel(ctx, config.web_rendering?.model);

  const pageImagePath = resolvePageImagePath(label, pageId);
  const pageImageBase64 = fs.readFileSync(pageImagePath).toString("base64");

  const sectioning = getPageSectioning(label, pageId);
  if (!sectioning) throw new Error("No page sectioning found");

  const { textLookup, imageMap } = buildTextLookup(label, pageId);

  const promptName = config.web_rendering?.prompt ?? "web_generation_html";

  const sectionRenderings: SectionRendering[] = [];
  for (let si = 0; si < sectioning.sections.length; si++) {
    const section = sectioning.sections[si];
    if (section.is_pruned) continue;

    const texts: RenderSectionText[] = [];
    const images: RenderSectionImage[] = [];
    for (const partId of section.part_ids) {
      const groupTexts = textLookup.get(partId);
      if (groupTexts) texts.push(...groupTexts);
      const imgBase64 = imageMap.get(partId);
      if (imgBase64) images.push({ image_id: partId, image_base64: imgBase64 });
    }

    if (texts.length === 0 && images.length === 0) continue;

    onProgress?.(`Rendering section ${si + 1}/${sectioning.sections.length}`);

    const rendering = await renderSection({
      label,
      pageId,
      model,
      pageImageBase64,
      sectionIndex: si,
      sectionType: section.section_type,
      texts,
      images,
      promptName,
      maxRetries: config.web_rendering?.max_retries ?? 2,
    });

    sectionRenderings.push(rendering);

    const sectionId = `${pageId}_s${String(si).padStart(3, "0")}`;
    putNodeData(label, "web-rendering", sectionId, 1, rendering);
  }

  // Stub if all sections pruned/empty
  if (sectionRenderings.length === 0) {
    const stub: SectionRendering = {
      section_index: 0,
      section_type: "empty",
      html: "",
      reasoning: "All sections on this page are pruned — nothing to render.",
    };
    sectionRenderings.push(stub);
    putNodeData(label, "web-rendering", `${pageId}_s000`, 1, stub);
  }

  // Clean up old versions for all sections of this page
  const db = getDb(label);
  const existingSections = db
    .prepare(
      `SELECT DISTINCT item_id FROM node_data
       WHERE node = 'web-rendering' AND item_id LIKE ? || '_s%'`
    )
    .all(pageId) as { item_id: string }[];
  for (const row of existingSections) {
    resetNodeVersions(label, "web-rendering", row.item_id);
  }

  return {
    sections: sectionRenderings.map((s) => ({
      ...s,
      version: 1,
      versions: [1],
    })),
  };
}

// ---------------------------------------------------------------------------
// Web edit — annotation-based LLM edit of a single section
// ---------------------------------------------------------------------------

export interface WebEditParams {
  pageId: string;
  sectionIndex: number;
  annotationImageBase64: string;
  annotations: Annotation[];
  currentHtml: string;
}

export interface WebEditResult {
  section: SectionRendering;
  version: number;
  versions: number[];
}

export async function runWebEdit(
  label: string,
  params: WebEditParams
): Promise<WebEditResult> {
  const { pageId, sectionIndex, annotationImageBase64, annotations, currentHtml } = params;
  const { config, ctx } = resolveCtx(label);
  const model = resolveModel(ctx, config.web_rendering?.model);

  const sectionId = `${pageId}_s${String(sectionIndex).padStart(3, "0")}`;

  const existingVersions = listWebRenderingVersions(label, sectionId);
  if (existingVersions.length === 0) throw new Error(`Section ${sectionId} not found`);
  const currentVersion = existingVersions[existingVersions.length - 1];
  const currentSection = getWebRenderingVersion(label, sectionId, currentVersion);
  if (!currentSection) throw new Error(`Section ${sectionId} not found`);

  // Derive allowed text/image IDs for validation
  let allowedTextIds: string[] | undefined;
  let allowedImageIds: string[] | undefined;
  const sectioning = getPageSectioning(label, pageId);
  try {
    const { textLookup } = buildTextLookup(label, pageId);
    if (sectioning) {
      const section = sectioning.sections[sectionIndex];
      if (section) {
        const allImgs = loadUnprunedImages(label, pageId);
        const imageIdSet = new Set(allImgs.map((img) => img.image_id));

        const textIds: string[] = [];
        const imageIds: string[] = [];
        for (const partId of section.part_ids) {
          const groupTexts = textLookup.get(partId);
          if (groupTexts) textIds.push(...groupTexts.map((t) => t.text_id));
          if (imageIdSet.has(partId)) imageIds.push(partId);
        }
        allowedTextIds = textIds;
        allowedImageIds = imageIds;
      }
    }
  } catch {
    // If we can't derive IDs, skip validation — edit still works
  }

  const result = await editSection({
    label,
    pageId,
    model,
    currentHtml,
    annotationImageBase64,
    annotations,
    allowedTextIds,
    allowedImageIds,
    maxRetries: config.web_rendering?.max_retries ?? 2,
  });

  const updatedSection = {
    ...currentSection,
    html: result.html,
    reasoning: result.reasoning,
  };

  const allVersions = listWebRenderingVersions(label, sectionId);
  const nextVersion =
    allVersions.length > 0 ? Math.max(...allVersions) + 1 : 2;

  putNodeData(label, "web-rendering", sectionId, nextVersion, updatedSection);

  return {
    section: updatedSection,
    version: nextVersion,
    versions: listWebRenderingVersions(label, sectionId),
  };
}

// ---------------------------------------------------------------------------
// Text classification — classify a single page
// ---------------------------------------------------------------------------

export interface TextClassificationResult {
  version: number;
  [key: string]: unknown;
}

export async function runTextClassification(
  label: string,
  pageId: string
): Promise<TextClassificationResult> {
  const { config, ctx } = resolveCtx(label);
  const model = resolveModel(ctx, config.text_classification?.model);

  const pageImagePath = resolvePageImagePath(label, pageId);
  const imageBase64 = fs.readFileSync(pageImagePath).toString("base64");

  const page = getPage(label, pageId);
  if (!page) throw new Error("Page not found");

  const metadata = getBookMetadata(label);
  const language = metadata?.language_code ?? "en";

  const promptName =
    config.text_classification?.prompt ?? "text_classification";

  const textTypeKeys = Object.keys(getTextTypes(config)) as [string, ...string[]];
  const groupTypeKeys = Object.keys(getTextGroupTypes(config)) as [string, ...string[]];
  const schema = buildLlmTextClassificationSchema(textTypeKeys, groupTypeKeys);

  const textTypes = Object.entries(getTextTypes(config)).map(([key, description]) => ({
    key,
    description,
  }));
  const textGroupTypes = Object.entries(getTextGroupTypes(config)).map(
    ([key, description]) => ({ key, description })
  );

  const pageNumber = parseInt(pageId.replace("pg", ""), 10);

  const classification = await classifyPage({
    label,
    model,
    schema,
    pageNumber,
    pageId,
    text: page.rawText,
    imageBase64,
    language,
    textTypes,
    textGroupTypes,
    prunedTextTypes: getPrunedTextTypes(config),
    promptName,
  });

  // Write result to DB as version 1
  putNodeData(label, "text-classification", pageId, 1, classification);

  // Reset version tracking
  resetNodeVersions(label, "text-classification", pageId);

  return { version: 1, ...classification };
}

// ---------------------------------------------------------------------------
// Page sectioning — section a single page
// ---------------------------------------------------------------------------

export async function runPageSectioning(
  label: string,
  pageId: string
) {
  const { config, ctx } = resolveCtx(label);

  const sectionTypes = config.section_types ?? {};
  if (Object.keys(sectionTypes).length === 0) {
    throw new Error("No section_types defined in config");
  }

  const model = resolveModel(ctx, config.page_sectioning?.model);

  const pageImagePath = resolvePageImagePath(label, pageId);
  const pageImageBase64 = fs.readFileSync(pageImagePath).toString("base64");

  const images = loadUnprunedImages(label, pageId);

  const extractionResult = getTextClassification(label, pageId);
  if (!extractionResult) throw new Error("No text classification found");
  const extraction = extractionResult.data;

  const groups = buildUnprunedGroupSummaries(extraction, pageId);

  const promptName = config.page_sectioning?.prompt ?? "page_sectioning";

  const sectionTypeList = Object.entries(sectionTypes).map(
    ([key, description]) => ({ key, description })
  );

  const sectioning = await sectionPage({
    label,
    pageId,
    model,
    pageImageBase64,
    images,
    groups,
    sectionTypes: sectionTypeList,
    promptName,
  });

  // Mark pruned sections
  const prunedSectionTypes = getPrunedSectionTypes(config);
  const prunedSet = new Set(prunedSectionTypes);
  for (const s of sectioning.sections) {
    s.is_pruned = prunedSet.has(s.section_type);
  }

  // Record classification versions used
  const imageClassResult = getImageClassification(label, pageId);
  sectioning.text_classification_version = extractionResult.version;
  sectioning.image_classification_version = imageClassResult?.version;

  putNodeData(label, "page-sectioning", pageId, 1, sectioning);

  return sectioning;
}

// ---------------------------------------------------------------------------
// Image classification — rule-based size filtering for one page (no LLM)
// ---------------------------------------------------------------------------

export function runImageClassification(label: string, pageId: string) {
  const { config, booksRoot } = resolveCtx(label);
  const sizeFilter = getImageFilters(config).size;

  const paths = resolveBookPaths(label, booksRoot);

  const imageInputs: ImageInput[] = [];
  for (const row of getExtractedImages(label, pageId)) {
    const absPath = path.join(paths.bookDir, row.path);
    if (!fs.existsSync(absPath)) continue;
    const buf = fs.readFileSync(absPath);
    imageInputs.push({
      image_id: row.image_id,
      path: row.path,
      buf,
    });
  }

  const classification = classifyPageImages(imageInputs, sizeFilter);

  // Prepend full page image as a pruned entry (available for cropping)
  const pageImagePath = path.join(paths.imagesDir, `${pageId}_page.png`);
  if (fs.existsSync(pageImagePath)) {
    const pageBuf = fs.readFileSync(pageImagePath);
    classification.images.unshift({
      image_id: `${pageId}_im000`,
      path: `images/${pageId}_page.png`,
      width: pageBuf.readUInt32BE(16),
      height: pageBuf.readUInt32BE(20),
      is_pruned: true,
    });
  }

  putNodeData(label, "image-classification", pageId, 1, classification);

  // Reset version tracking
  resetNodeVersions(label, "image-classification", pageId);

  return classification;
}

// ---------------------------------------------------------------------------
// Page pipeline — full sequential processing of one page
//   image classification → text classification → page sectioning → web rendering
// ---------------------------------------------------------------------------

export async function runPagePipeline(
  label: string,
  pageId: string,
  onProgress?: (message: string) => void
) {
  onProgress?.("Classifying images");
  runImageClassification(label, pageId);

  onProgress?.("Classifying text");
  await runTextClassification(label, pageId);

  onProgress?.("Sectioning page");
  await runPageSectioning(label, pageId);

  onProgress?.("Rendering web pages");
  await runWebRendering(label, pageId, onProgress);
}
