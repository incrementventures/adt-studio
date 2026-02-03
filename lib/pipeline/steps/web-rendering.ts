/**
 * Web Rendering Step
 *
 * Renders page sections as HTML using an LLM. Each section is rendered
 * independently, producing semantic HTML with data-id attributes for
 * text and image references.
 */

import type { Page, PageImage, LLMModel, ValidationResult } from "../core/types";
import {
  type TextClassificationOutput,
  type PageSectioningOutput,
  type SectionRendering,
  type WebRenderingOutput,
  webRenderingLLMResponseSchema,
} from "../core/schemas";
import { loadPrompt } from "../core/llm";
import { validateSectionHtml } from "../web-rendering/validate-html";

// ============================================================================
// Input types
// ============================================================================

export interface RenderPageInput {
  page: Page;
  sectioning: PageSectioningOutput;
  textClassification: TextClassificationOutput;
  images: Map<string, string>; // imageId → base64
  model: LLMModel;
  promptName: string;
  maxRetries?: number;
}

export interface RenderSectionInput {
  page: Page;
  sectionIndex: number;
  sectionType: string;
  texts: TextInput[];
  images: ImageInput[];
  model: LLMModel;
  promptName: string;
  maxRetries?: number;
}

export interface TextInput {
  textId: string;
  textType: string;
  text: string;
}

export interface ImageInput {
  imageId: string;
  imageBase64: string;
}

// ============================================================================
// Raw LLM response type
// ============================================================================

interface RawWebRenderingResponse {
  reasoning: string;
  content: string;
}

// ============================================================================
// Pure step functions
// ============================================================================

/**
 * Render all sections for a page as HTML.
 *
 * This is a pure async function that:
 * 1. Iterates through non-pruned sections
 * 2. Collects inputs for each section
 * 3. Renders each section via LLM
 * 4. Returns the combined results
 */
export async function renderPage(
  input: RenderPageInput
): Promise<WebRenderingOutput> {
  const {
    page,
    sectioning,
    textClassification,
    images,
    model,
    promptName,
    maxRetries,
  } = input;

  const sections: SectionRendering[] = [];

  for (let i = 0; i < sectioning.sections.length; i++) {
    const section = sectioning.sections[i];

    // Skip pruned sections
    if (section.isPruned) {
      continue;
    }

    // Collect inputs for this section
    const sectionInputs = collectSectionInputs(
      section,
      textClassification,
      images,
      page.pageId
    );

    // Skip sections with no content
    if (sectionInputs.texts.length === 0 && sectionInputs.images.length === 0) {
      continue;
    }

    // Render the section
    const rendering = await renderSection({
      page,
      sectionIndex: i,
      sectionType: section.sectionType,
      texts: sectionInputs.texts,
      images: sectionInputs.images,
      model,
      promptName,
      maxRetries,
    });

    sections.push(rendering);
  }

  return { sections };
}

/**
 * Render a single section as HTML.
 *
 * Validates the generated HTML to ensure:
 * - All data-id attributes reference valid text/image IDs
 * - No duplicate data-id values
 * - All text content is wrapped in elements with data-id
 */
export async function renderSection(
  input: RenderSectionInput
): Promise<SectionRendering> {
  const {
    page,
    sectionIndex,
    sectionType,
    texts,
    images,
    model,
    promptName,
    maxRetries,
  } = input;

  // Build allowed IDs for validation
  const allowedTextIds = texts.map((t) => t.textId);
  const allowedImageIds = images.map((img) => img.imageId);

  // Build prompt context
  const promptContext = {
    page_image_base64: page.pageImageBase64,
    section_type: sectionType,
    texts: texts.map((t) => ({
      text_id: t.textId,
      text_type: t.textType,
      text: t.text,
    })),
    images: images.map((img) => ({
      image_id: img.imageId,
      image_base64: img.imageBase64,
    })),
  };

  // Load and render the prompt
  const { system, messages } = await loadPrompt(promptName, promptContext);

  // Validator function for HTML content
  const validate = (result: unknown): ValidationResult => {
    const r = result as RawWebRenderingResponse;
    return validateSectionHtml(r.content, allowedTextIds, allowedImageIds);
  };

  // Call LLM with validation
  const result = await model.generateObject<RawWebRenderingResponse>({
    schema: webRenderingLLMResponseSchema,
    system,
    messages,
    validate,
    maxRetries: maxRetries ?? 2,
    log: {
      taskType: "web-rendering",
      pageId: page.pageId,
      promptName,
    },
  });

  return {
    sectionIndex,
    sectionType,
    reasoning: result.object.reasoning,
    html: result.object.content,
  };
}

// ============================================================================
// Helper functions
// ============================================================================

interface SectionInputs {
  texts: TextInput[];
  images: ImageInput[];
}

/**
 * Collect the unpruned texts and images for a section.
 */
function collectSectionInputs(
  section: PageSectioningOutput["sections"][number],
  textClassification: TextClassificationOutput,
  imageMap: Map<string, string>,
  pageId: string
): SectionInputs {
  const texts: TextInput[] = [];
  const images: ImageInput[] = [];

  // Build a lookup for groups by ID
  const groupsById = new Map(
    textClassification.groups.map((g) => [g.groupId, g])
  );

  for (const partId of section.partIds) {
    // Check if it's a group
    const group = groupsById.get(partId);
    if (group) {
      // Add each unpruned text entry
      group.texts.forEach((t, ti) => {
        if (t.isPruned) return;
        texts.push({
          textId: `${partId}_t${String(ti + 1).padStart(3, "0")}`,
          textType: t.textType,
          text: t.text,
        });
      });
      continue;
    }

    // Check if it's an image
    const imgBase64 = imageMap.get(partId);
    if (imgBase64) {
      images.push({
        imageId: partId,
        imageBase64: imgBase64,
      });
    }
  }

  return { texts, images };
}

// ============================================================================
// Section editing (for annotation-based edits)
// ============================================================================

export interface EditSectionInput {
  page: Page;
  currentHtml: string;
  annotationImageBase64: string;
  annotations: Annotation[];
  allowedTextIds?: string[];
  allowedImageIds?: string[];
  model: LLMModel;
  promptName: string;
  maxRetries?: number;
}

export interface Annotation {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface SectionEditOutput {
  reasoning: string;
  html: string;
}

/**
 * Edit a section based on annotations.
 *
 * Takes the current HTML and an annotated screenshot, then asks the LLM
 * to produce updated HTML incorporating the requested changes.
 */
export async function editSection(
  input: EditSectionInput
): Promise<SectionEditOutput> {
  const {
    page,
    currentHtml,
    annotationImageBase64,
    annotations,
    allowedTextIds,
    allowedImageIds,
    model,
    promptName,
    maxRetries,
  } = input;

  // Build prompt context
  const promptContext = {
    current_html: currentHtml,
    annotation_image_base64: annotationImageBase64,
    annotations,
  };

  // Load and render the prompt
  const { system, messages } = await loadPrompt(promptName, promptContext);

  // Validator if we have allowed IDs - note: schema uses "content" field
  const validate =
    allowedTextIds && allowedImageIds
      ? (result: unknown): ValidationResult => {
          const r = result as { content: string };
          return validateSectionHtml(r.content, allowedTextIds, allowedImageIds);
        }
      : undefined;

  // Call LLM - schema uses "content" field, we convert to "html" for output
  const result = await model.generateObject<{ reasoning: string; content: string }>(
    {
      schema: webRenderingLLMResponseSchema,
      system,
      messages,
      validate,
      maxRetries: maxRetries ?? 2,
      log: {
        taskType: "web-edit",
        pageId: page.pageId,
        promptName,
      },
    }
  );

  return {
    reasoning: result.object.reasoning,
    html: result.object.content,
  };
}
