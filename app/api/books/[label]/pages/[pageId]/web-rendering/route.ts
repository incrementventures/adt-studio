import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getBooksRoot,
  getTextClassification,
  getPageSectioning,
  loadUnprunedImages,
  resolvePageImagePath,
} from "@/lib/books";
import { loadConfig } from "@/lib/config";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { createContext, resolveModel } from "@/lib/pipeline/node";
import type { LLMProvider } from "@/lib/pipeline/node";
import { renderSection, type RenderSectionText, type RenderSectionImage } from "@/lib/pipeline/web-rendering/render-section";
import type { SectionRendering } from "@/lib/pipeline/web-rendering/web-rendering-schema";

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

  // Load sectioning
  const sectioning = getPageSectioning(label, pageId);
  if (!sectioning) {
    return NextResponse.json(
      { error: "No page sectioning found — run sectioning first" },
      { status: 404 }
    );
  }

  // Load text classification
  const extractionResult = getTextClassification(label, pageId);
  if (!extractionResult) {
    return NextResponse.json(
      { error: "No text classification found for this page" },
      { status: 404 }
    );
  }
  const extraction = extractionResult.data;

  // Load images
  const allImages = loadUnprunedImages(label, pageId);
  const imageMap = new Map(
    allImages.map((img) => [img.image_id, img.imageBase64])
  );

  // Build text lookup
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

  // Resolve model
  const ctx = createContext(label, {
    config,
    outputRoot: booksRoot,
    provider: (config.provider as LLMProvider | undefined) ?? "openai",
  });
  const model = resolveModel(ctx, config.web_rendering?.model);
  const promptName = config.web_rendering?.prompt ?? "web_generation_html";
  const renderingDir = paths.webRenderingDir;
  fs.mkdirSync(renderingDir, { recursive: true });

  // Render each non-pruned section and write per-section files
  const sectionRenderings: SectionRendering[] = [];
  for (let si = 0; si < sectioning.sections.length; si++) {
    const section = sectioning.sections[si];
    if (section.is_pruned) continue;

    const texts: RenderSectionText[] = [];
    const images: RenderSectionImage[] = [];
    for (const partId of section.part_ids) {
      const groupTexts = textLookup.get(partId);
      if (groupTexts) {
        texts.push(...groupTexts);
      }
      const imgBase64 = imageMap.get(partId);
      if (imgBase64) {
        images.push({ image_id: partId, image_base64: imgBase64 });
      }
    }

    if (texts.length === 0 && images.length === 0) continue;

    const rendering = await renderSection({
      model,
      pageImageBase64,
      sectionIndex: si,
      sectionType: section.section_type,
      texts,
      images,
      promptName,
      cacheDir: renderingDir,
    });

    sectionRenderings.push(rendering);

    // Write individual section file
    const sectionId = `${pageId}_s${String(si).padStart(3, "0")}`;
    fs.writeFileSync(
      path.join(renderingDir, `${sectionId}.json`),
      JSON.stringify(rendering, null, 2) + "\n"
    );
  }

  // Clean up old versioned files, .current files, and legacy page-level file
  for (const f of fs.readdirSync(renderingDir)) {
    if (
      // Old per-section versioned files: {pageId}_s*.v*.json
      new RegExp(`^${pageId}_s\\d{3}\\.v\\d{3}\\.json$`).test(f) ||
      // Old per-section .current files: {pageId}_s*.current
      new RegExp(`^${pageId}_s\\d{3}\\.current$`).test(f) ||
      // Legacy page-level files
      f === `${pageId}.json` ||
      new RegExp(`^${pageId}\\.v\\d{3}\\.json$`).test(f) ||
      f === `${pageId}.current`
    ) {
      fs.unlinkSync(path.join(renderingDir, f));
    }
  }

  return NextResponse.json({
    sections: sectionRenderings.map((s) => ({
      ...s,
      version: 1,
      versions: [1],
    })),
  });
}
