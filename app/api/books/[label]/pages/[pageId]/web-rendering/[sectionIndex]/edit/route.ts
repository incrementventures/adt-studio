import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getBooksRoot,
  getCurrentWebRenderingVersion,
  getTextClassification,
  getPageSectioning,
  getWebRenderingVersion,
  listWebRenderingVersions,
  loadUnprunedImages,
  setCurrentWebRenderingVersion,
} from "@/lib/books";
import { loadConfig } from "@/lib/config";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { createContext, resolveModel } from "@/lib/pipeline/node";
import type { LLMProvider } from "@/lib/pipeline/node";
import { editSection, type Annotation } from "@/lib/pipeline/web-rendering/edit-section";
import type { RenderSectionText } from "@/lib/pipeline/web-rendering/render-section";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ label: string; pageId: string; sectionIndex: string }>;
  }
) {
  const { label, pageId, sectionIndex: sectionIndexStr } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const sectionIndex = parseInt(sectionIndexStr, 10);
  if (isNaN(sectionIndex) || sectionIndex < 0) {
    return NextResponse.json(
      { error: "Invalid section index" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const {
    annotationImageBase64,
    annotations,
    currentHtml,
  } = body as {
    annotationImageBase64: string;
    annotations: Annotation[];
    currentHtml: string;
  };

  if (!annotationImageBase64 || !annotations || !currentHtml) {
    return NextResponse.json(
      { error: "Missing required fields: annotationImageBase64, annotations, currentHtml" },
      { status: 400 }
    );
  }

  const sectionId = `${pageId}_s${String(sectionIndex).padStart(3, "0")}`;

  const config = loadConfig();
  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);
  const renderingDir = paths.webRenderingDir;

  // Read current version of this section
  const currentVersion = getCurrentWebRenderingVersion(label, sectionId);
  const currentSection = getWebRenderingVersion(label, sectionId, currentVersion);
  if (!currentSection) {
    return NextResponse.json(
      { error: `Section ${sectionId} not found` },
      { status: 404 }
    );
  }

  const ctx = createContext(label, {
    config,
    outputRoot: booksRoot,
    provider: (config.provider as LLMProvider | undefined) ?? "openai",
  });
  const model = resolveModel(ctx, config.web_rendering?.model);

  // Derive allowed text/image IDs for this section
  let allowedTextIds: string[] | undefined;
  let allowedImageIds: string[] | undefined;
  const extractionResult = getTextClassification(label, pageId);
  const sectioning = getPageSectioning(label, pageId);
  if (extractionResult && sectioning) {
    const extraction = extractionResult.data;
    const section = sectioning.sections[sectionIndex];
    if (section) {
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
      const imageIdSet = new Set(allImages.map((img) => img.image_id));

      const textIds: string[] = [];
      const imageIds: string[] = [];
      for (const partId of section.part_ids) {
        const groupTexts = textLookup.get(partId);
        if (groupTexts) {
          textIds.push(...groupTexts.map((t) => t.text_id));
        }
        if (imageIdSet.has(partId)) {
          imageIds.push(partId);
        }
      }
      allowedTextIds = textIds;
      allowedImageIds = imageIds;
    }
  }

  const result = await editSection({
    model,
    currentHtml,
    annotationImageBase64,
    annotations,
    cacheDir: renderingDir,
    allowedTextIds,
    allowedImageIds,
    maxRetries: config.web_rendering?.max_retries ?? 2,
  });

  // Build updated section
  const updatedSection = {
    ...currentSection,
    html: result.html,
    reasoning: result.reasoning,
  };

  // Compute next version and write versioned file
  const existingVersions = listWebRenderingVersions(label, sectionId);
  const nextVersion =
    existingVersions.length > 0
      ? Math.max(...existingVersions) + 1
      : 2;

  fs.writeFileSync(
    path.join(
      renderingDir,
      `${sectionId}.v${String(nextVersion).padStart(3, "0")}.json`
    ),
    JSON.stringify(updatedSection, null, 2) + "\n"
  );
  setCurrentWebRenderingVersion(label, sectionId, nextVersion);

  const updatedVersions = listWebRenderingVersions(label, sectionId);
  return NextResponse.json({
    section: updatedSection,
    version: nextVersion,
    versions: updatedVersions,
  });
}
