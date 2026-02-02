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
  listImageClassificationVersions,
  listTextClassificationVersions,
  listPageSectioningVersions,
  getImageHashes,
  putNodeData,
} from "@/lib/books";

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
import { renderSection } from "@/lib/pipeline/web-rendering/render-section";
import { collectSectionInputs } from "@/lib/pipeline/web-rendering/collect-section-inputs";
import type { SectionRendering } from "@/lib/pipeline/web-rendering/web-rendering-schema";
import { editSection, type Annotation } from "@/lib/pipeline/web-rendering/edit-section";
import { classifyPage } from "@/lib/pipeline/text-classification/classify-page";
import { buildLlmTextClassificationSchema } from "@/lib/pipeline/text-classification/text-classification-schema";
import { sectionPage } from "@/lib/pipeline/page-sectioning/section-page";
import { buildUnprunedGroupSummaries, buildGroupsRecord } from "@/lib/pipeline/text-classification/text-classification-schema";
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

/** Build image map for a page (image_id → base64, extraction-level unpruned). */
function buildImageMap(label: string, pageId: string): Map<string, string> {
  const allImages = loadUnprunedImages(label, pageId);
  return new Map(allImages.map((img) => [img.image_id, img.imageBase64]));
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
  onProgress?: (message: string) => void,
  options?: { skipCache?: boolean }
): Promise<WebRenderingResult> {
  const { config, ctx } = resolveCtx(label);
  const model = resolveModel(ctx, config.web_rendering?.model);

  const pageImagePath = resolvePageImagePath(label, pageId);
  const pageImageBase64 = fs.readFileSync(pageImagePath).toString("base64");

  const sectioningResult = getPageSectioning(label, pageId);
  if (!sectioningResult) throw new Error("No page sectioning found");
  const sectioning = sectioningResult.data;

  const imageMap = buildImageMap(label, pageId);

  const promptName = config.web_rendering?.prompt ?? "web_generation_html";

  const sectionRenderings: SectionRendering[] = [];
  for (let si = 0; si < sectioning.sections.length; si++) {
    const section = sectioning.sections[si];
    if (section.is_pruned) continue;

    const { texts, images } = collectSectionInputs({
      section,
      sectioning,
      imageMap,
      pageId,
    });

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
      skipCache: options?.skipCache,
    });

    sectionRenderings.push(rendering);

    const sectionId = `${pageId}_s${String(si).padStart(3, "0")}`;
    const existingVersions = listWebRenderingVersions(label, sectionId);
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;
    putNodeData(label, "web-rendering", sectionId, nextVersion, rendering);
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
    const stubId = `${pageId}_s000`;
    const stubVersions = listWebRenderingVersions(label, stubId);
    const stubNextVersion = stubVersions.length > 0 ? Math.max(...stubVersions) + 1 : 1;
    putNodeData(label, "web-rendering", stubId, stubNextVersion, stub);
  }

  return {
    sections: sectionRenderings.map((s) => {
      const sectionId = `${pageId}_s${String(s.section_index).padStart(3, "0")}`;
      const versions = listWebRenderingVersions(label, sectionId);
      const version = versions.length > 0 ? Math.max(...versions) : 1;
      return { ...s, version, versions };
    }),
  };
}

// ---------------------------------------------------------------------------
// Web rendering — render a single section for one page
// ---------------------------------------------------------------------------

export async function runWebRenderingSection(
  label: string,
  pageId: string,
  sectionIndex: number,
  onProgress?: (message: string) => void,
  options?: { skipCache?: boolean }
): Promise<WebEditResult> {
  const { config, ctx } = resolveCtx(label);
  const model = resolveModel(ctx, config.web_rendering?.model);

  const pageImagePath = resolvePageImagePath(label, pageId);
  const pageImageBase64 = fs.readFileSync(pageImagePath).toString("base64");

  const sectioningResult = getPageSectioning(label, pageId);
  if (!sectioningResult) throw new Error("No page sectioning found");

  const section = sectioningResult.data.sections[sectionIndex];
  if (!section) throw new Error(`Section ${sectionIndex} not found`);
  if (section.is_pruned) throw new Error(`Section ${sectionIndex} is pruned`);

  const imageMap = buildImageMap(label, pageId);

  const { texts, images } = collectSectionInputs({
    section,
    sectioning: sectioningResult.data,
    imageMap,
    pageId,
  });

  if (texts.length === 0 && images.length === 0) {
    throw new Error(`Section ${sectionIndex} has no texts or images`);
  }

  const promptName = config.web_rendering?.prompt ?? "web_generation_html";

  onProgress?.(`Rendering section ${sectionIndex + 1}/${sectioningResult.data.sections.length}`);

  const rendering = await renderSection({
    label,
    pageId,
    model,
    pageImageBase64,
    sectionIndex,
    sectionType: section.section_type,
    texts,
    images,
    promptName,
    maxRetries: config.web_rendering?.max_retries ?? 2,
    skipCache: options?.skipCache,
  });

  const sectionId = `${pageId}_s${String(sectionIndex).padStart(3, "0")}`;
  const existingVersions = listWebRenderingVersions(label, sectionId);
  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;
  putNodeData(label, "web-rendering", sectionId, nextVersion, rendering);

  return {
    section: rendering,
    version: nextVersion,
    versions: listWebRenderingVersions(label, sectionId),
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
  const sectioningResult = getPageSectioning(label, pageId);
  try {
    if (sectioningResult) {
      const section = sectioningResult.data.sections[sectionIndex];
      if (section) {
        const imageMap = buildImageMap(label, pageId);
        const { texts, images: imgs } = collectSectionInputs({
          section,
          sectioning: sectioningResult.data,
          imageMap,
          pageId,
        });
        allowedTextIds = texts.map((t) => t.text_id);
        allowedImageIds = imgs.map((i) => i.image_id);
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
  pageId: string,
  options?: { skipCache?: boolean }
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
    skipCache: options?.skipCache,
  });

  const existingVersions = listTextClassificationVersions(label, pageId);
  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;
  putNodeData(label, "text-classification", pageId, nextVersion, classification);

  return { version: nextVersion, versions: listTextClassificationVersions(label, pageId), data: classification };
}

// ---------------------------------------------------------------------------
// Page sectioning — section a single page
// ---------------------------------------------------------------------------

export async function runPageSectioning(
  label: string,
  pageId: string,
  options?: { skipCache?: boolean }
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
    skipCache: options?.skipCache,
  });

  // Mark pruned sections
  const prunedSectionTypes = getPrunedSectionTypes(config);
  const prunedSet = new Set(prunedSectionTypes);
  for (const s of sectioning.sections) {
    s.is_pruned = prunedSet.has(s.section_type);
  }

  // Embed all text groups from extraction
  sectioning.groups = buildGroupsRecord(extraction, pageId);

  // Embed image assignments — images not assigned to any section are pruned
  const assignedPartIds = new Set(sectioning.sections.flatMap((s) => s.part_ids));
  sectioning.images = {};
  for (const img of images) {
    sectioning.images[img.image_id] = { is_pruned: !assignedPartIds.has(img.image_id) };
  }

  // Record classification versions used
  const imageClassResult = getImageClassification(label, pageId);
  sectioning.text_classification_version = extractionResult.version;
  sectioning.image_classification_version = imageClassResult?.version;

  const existingVersions = listPageSectioningVersions(label, pageId);
  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;
  putNodeData(label, "page-sectioning", pageId, nextVersion, sectioning);

  return { version: nextVersion, versions: listPageSectioningVersions(label, pageId), data: sectioning };
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

  // im000 is the full page render — always pruned (kept for cropping only)
  for (const img of classification.images) {
    if (img.image_id === `${pageId}_page`) {
      img.is_pruned = true;
      break;
    }
  }

  const existingVersions = listImageClassificationVersions(label, pageId);
  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;
  putNodeData(label, "image-classification", pageId, nextVersion, classification);

  const imageHashes = getImageHashes(label, pageId);
  return { version: nextVersion, versions: listImageClassificationVersions(label, pageId), imageHashes, data: classification };
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
