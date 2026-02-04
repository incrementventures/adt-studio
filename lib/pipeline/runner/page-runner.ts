/**
 * Page Runner
 *
 * Orchestrates pure pipeline steps for a single page.
 * Handles loading data from storage, calling steps, and saving results.
 */

import type {
  Storage,
  Progress,
  PageRunnerConfig,
  RunOptions,
  StepName,
} from "./types";
import { classifyImages } from "../steps/image-classification";
import { classifyText } from "../steps/text-classification";
import { sectionPage } from "../steps/page-sectioning";
import { renderPage, renderSection, editSection } from "../steps/web-rendering";
import type { SectionRendering, WebRenderingOutput } from "../core/schemas";
import type { Annotation } from "../steps/web-rendering";

// ============================================================================
// Main pipeline runner
// ============================================================================

/**
 * Run the full pipeline for a single page.
 *
 * Steps are run in order:
 * 1. Image Classification (rule-based)
 * 2. Text Classification (LLM)
 * 3. Page Sectioning (LLM)
 * 4. Web Rendering (LLM, per section)
 */
export async function runPagePipeline(
  pageId: string,
  runner: PageRunnerConfig,
  options?: RunOptions
): Promise<void> {
  const { storage, progress, config, model, prompts } = runner;
  const steps = options?.steps ?? [
    "image-classification",
    "text-classification",
    "page-sectioning",
    "web-rendering",
  ];

  // Load the page
  const page = await storage.getPage(pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Step 1: Image Classification
  let imageClassificationVersion = 0;
  if (steps.includes("image-classification")) {
    progress.emit({ type: "step-start", step: "image-classification", pageId });

    try {
      const images = await storage.getPageImages(pageId);
      const result = classifyImages({
        pageId,
        images,
        filters: config.imageFilters,
      });

      const { version } = await storage.putImageClassification(pageId, result);
      imageClassificationVersion = version;
      progress.emit({
        type: "step-complete",
        step: "image-classification",
        pageId,
        version,
      });
    } catch (err) {
      progress.emit({
        type: "step-error",
        step: "image-classification",
        pageId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } else {
    // Load existing version
    const existing = await storage.getImageClassification(pageId);
    imageClassificationVersion = existing?.version ?? 0;
  }

  // Step 2: Text Classification
  let textClassificationVersion = 0;
  if (steps.includes("text-classification")) {
    progress.emit({ type: "step-start", step: "text-classification", pageId });

    try {
      const result = await classifyText({
        page,
        language: config.language,
        textTypes: config.textTypes,
        textGroupTypes: config.textGroupTypes,
        prunedTextTypes: config.prunedTextTypes,
        model,
        promptName: prompts.textClassification,
      });

      const { version } = await storage.putTextClassification(pageId, result);
      textClassificationVersion = version;
      progress.emit({
        type: "step-complete",
        step: "text-classification",
        pageId,
        version,
      });
    } catch (err) {
      progress.emit({
        type: "step-error",
        step: "text-classification",
        pageId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } else {
    // Load existing version
    const existing = await storage.getTextClassification(pageId);
    textClassificationVersion = existing?.version ?? 0;
  }

  // Step 3: Page Sectioning
  if (steps.includes("page-sectioning")) {
    progress.emit({ type: "step-start", step: "page-sectioning", pageId });

    try {
      // Load required data
      const textClassification = await storage.getTextClassification(pageId);
      if (!textClassification) {
        throw new Error("Text classification required for page sectioning");
      }

      const imageClassification = await storage.getImageClassification(pageId);
      if (!imageClassification) {
        throw new Error("Image classification required for page sectioning");
      }

      const images = await storage.getPageImages(pageId);

      const result = await sectionPage({
        page,
        textClassification: textClassification.data,
        imageClassification: imageClassification.data,
        images,
        sectionTypes: config.sectionTypes,
        prunedSectionTypes: config.prunedSectionTypes,
        model,
        promptName: prompts.pageSectioning,
      });

      const { version } = await storage.putPageSectioning(
        pageId,
        result,
        textClassification.version,
        imageClassification.version
      );
      progress.emit({
        type: "step-complete",
        step: "page-sectioning",
        pageId,
        version,
      });
    } catch (err) {
      progress.emit({
        type: "step-error",
        step: "page-sectioning",
        pageId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // Step 4: Web Rendering
  if (steps.includes("web-rendering")) {
    progress.emit({ type: "step-start", step: "web-rendering", pageId });

    try {
      // Load sectioning (includes embedded text/image classification used when sections were created)
      const sectioning = await storage.getPageSectioning(pageId);

      if (!sectioning) {
        throw new Error("Page sectioning required for web rendering");
      }

      const images = await storage.getPageImages(pageId);
      const imageMap = new Map(images.map((img) => [img.imageId, img.imageBase64]));

      // Render all sections (texts/images are already resolved in sectioning)
      const result = await renderPage({
        page,
        sectioning: sectioning.data,
        images: imageMap,
        model,
        promptName: prompts.webRendering,
        maxRetries: 2,
      });

      // Save each section
      for (let i = 0; i < sectioning.data.sections.length; i++) {
        const sectionId = `${pageId}_s${String(i + 1).padStart(3, "0")}`;
        const section = sectioning.data.sections[i];

        // Find the rendering for this section (if it was rendered)
        const rendering = result.sections.find((s) => s.sectionIndex === i);

        if (section.isPruned || !rendering) {
          // Save null for pruned/empty sections
          await storage.putSectionRendering(sectionId, null);
        } else {
          await storage.putSectionRendering(sectionId, rendering);
        }

        progress.emit({
          type: "step-progress",
          step: "web-rendering",
          pageId,
          message: `Rendered section ${i + 1}/${sectioning.data.sections.length}`,
        });
      }

      // Handle case where there are no sections
      if (sectioning.data.sections.length === 0) {
        const sectionId = `${pageId}_s001`;
        await storage.putSectionRendering(sectionId, null);
      }

      progress.emit({
        type: "step-complete",
        step: "web-rendering",
        pageId,
        version: 1,
      });
    } catch (err) {
      progress.emit({
        type: "step-error",
        step: "web-rendering",
        pageId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

// ============================================================================
// Individual step runners (for re-running specific steps)
// ============================================================================

/**
 * Run just image classification for a page.
 */
export async function runImageClassification(
  pageId: string,
  runner: PageRunnerConfig
): Promise<{ version: number }> {
  const { storage, config } = runner;

  const images = await storage.getPageImages(pageId);
  const result = classifyImages({
    pageId,
    images,
    filters: config.imageFilters,
  });

  return storage.putImageClassification(pageId, result);
}

/**
 * Run just text classification for a page.
 */
export async function runTextClassification(
  pageId: string,
  runner: PageRunnerConfig
): Promise<{ version: number }> {
  const { storage, config, model, prompts } = runner;

  const page = await storage.getPage(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  const result = await classifyText({
    page,
    language: config.language,
    textTypes: config.textTypes,
    textGroupTypes: config.textGroupTypes,
    prunedTextTypes: config.prunedTextTypes,
    model,
    promptName: prompts.textClassification,
  });

  return storage.putTextClassification(pageId, result);
}

/**
 * Run just page sectioning for a page.
 */
export async function runPageSectioning(
  pageId: string,
  runner: PageRunnerConfig
): Promise<{ version: number }> {
  const { storage, config, model, prompts } = runner;

  const page = await storage.getPage(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  const textClassification = await storage.getTextClassification(pageId);
  if (!textClassification) throw new Error("Text classification required");

  const imageClassification = await storage.getImageClassification(pageId);
  if (!imageClassification) throw new Error("Image classification required");

  const images = await storage.getPageImages(pageId);

  const result = await sectionPage({
    page,
    textClassification: textClassification.data,
    imageClassification: imageClassification.data,
    images,
    sectionTypes: config.sectionTypes,
    prunedSectionTypes: config.prunedSectionTypes,
    model,
    promptName: prompts.pageSectioning,
  });

  return storage.putPageSectioning(
    pageId,
    result,
    textClassification.version,
    imageClassification.version
  );
}

/**
 * Run web rendering for all sections of a page.
 */
export async function runWebRendering(
  pageId: string,
  runner: PageRunnerConfig,
  onProgress?: (message: string) => void
): Promise<WebRenderingOutput> {
  const { storage, model, prompts } = runner;

  const page = await storage.getPage(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  const sectioning = await storage.getPageSectioning(pageId);
  if (!sectioning) {
    throw new Error("Page sectioning required");
  }

  const images = await storage.getPageImages(pageId);
  const imageMap = new Map(images.map((img) => [img.imageId, img.imageBase64]));

  // Render all sections (texts/images are already resolved in sectioning)
  const result = await renderPage({
    page,
    sectioning: sectioning.data,
    images: imageMap,
    model,
    promptName: prompts.webRendering,
    maxRetries: 2,
  });

  // Save each section
  for (let i = 0; i < sectioning.data.sections.length; i++) {
    const sectionId = `${pageId}_s${String(i + 1).padStart(3, "0")}`;
    const section = sectioning.data.sections[i];
    const rendering = result.sections.find((s) => s.sectionIndex === i);

    if (section.isPruned || !rendering) {
      await storage.putSectionRendering(sectionId, null);
    } else {
      await storage.putSectionRendering(sectionId, rendering);
    }

    onProgress?.(`Rendered section ${i + 1}/${sectioning.data.sections.length}`);
  }

  if (sectioning.data.sections.length === 0) {
    const sectionId = `${pageId}_s001`;
    await storage.putSectionRendering(sectionId, null);
  }

  return result;
}

/**
 * Re-render a single section.
 */
export async function runWebRenderingSection(
  pageId: string,
  sectionIndex: number,
  runner: PageRunnerConfig
): Promise<SectionRendering> {
  const { storage, model, prompts } = runner;

  const page = await storage.getPage(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  const sectioning = await storage.getPageSectioning(pageId);
  if (!sectioning) {
    throw new Error("Page sectioning required");
  }

  const section = sectioning.data.sections[sectionIndex];
  if (!section) throw new Error(`Section ${sectionIndex} not found`);
  if (section.isPruned) throw new Error(`Section ${sectionIndex} is pruned`);

  const images = await storage.getPageImages(pageId);
  const imageMap = new Map(images.map((img) => [img.imageId, img.imageBase64]));

  // Use resolved texts and imageIds from section
  const texts = section.texts ?? [];
  const sectionImages = (section.imageIds ?? [])
    .map((imageId) => {
      const imageBase64 = imageMap.get(imageId);
      if (!imageBase64) return null;
      return { imageId, imageBase64 };
    })
    .filter((img): img is { imageId: string; imageBase64: string } => img !== null);

  if (texts.length === 0 && sectionImages.length === 0) {
    throw new Error(`Section ${sectionIndex} has no content`);
  }

  const rendering = await renderSection({
    page,
    sectionIndex,
    sectionType: section.sectionType,
    texts,
    images: sectionImages,
    model,
    promptName: prompts.webRendering,
    maxRetries: 2,
  });

  // Save the result
  const sectionId = `${pageId}_s${String(sectionIndex + 1).padStart(3, "0")}`;
  await storage.putSectionRendering(sectionId, rendering);

  return rendering;
}

/**
 * Edit a section based on annotations.
 */
export async function runWebEdit(
  pageId: string,
  sectionIndex: number,
  annotationImageBase64: string,
  annotations: Annotation[],
  currentHtml: string,
  runner: PageRunnerConfig
): Promise<SectionRendering> {
  const { storage, model, prompts } = runner;

  const page = await storage.getPage(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  // Get allowed IDs for validation using resolved content from sectioning
  const sectioning = await storage.getPageSectioning(pageId);
  let allowedTextIds: string[] | undefined;
  let allowedImageIds: string[] | undefined;

  if (sectioning) {
    const section = sectioning.data.sections[sectionIndex];
    if (section) {
      allowedTextIds = (section.texts ?? []).map((t) => t.textId);
      allowedImageIds = section.imageIds ?? [];
    }
  }

  const result = await editSection({
    page,
    currentHtml,
    annotationImageBase64,
    annotations,
    allowedTextIds,
    allowedImageIds,
    model,
    promptName: prompts.sectionEdit ?? "web_edit",
    maxRetries: 2,
  });

  // Get current section data and update
  const sectionId = `${pageId}_s${String(sectionIndex + 1).padStart(3, "0")}`;
  const existing = await storage.getSectionRendering(sectionId);

  const updatedRendering: SectionRendering = {
    sectionIndex,
    sectionType: existing?.data.sectionType ?? "unknown",
    reasoning: result.reasoning,
    html: result.html,
  };

  await storage.putSectionRendering(sectionId, updatedRendering);

  return updatedRendering;
}

// ============================================================================
// Helper functions
