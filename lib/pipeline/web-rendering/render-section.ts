import type { LanguageModel } from "ai";
import { cachedPromptGenerateObject } from "@/lib/pipeline/cache";
import {
  webRenderingResponseSchema,
  type SectionRendering,
} from "./web-rendering-schema";
import { validateSectionHtml } from "./validate-html";

export interface RenderSectionText {
  text_id: string;
  text_type: string;
  text: string;
}

export interface RenderSectionImage {
  image_id: string;
  image_base64: string;
}

/**
 * Pure function: runs the web rendering LLM call for a single section.
 * No disk reads or writes — the caller is responsible for loading inputs
 * and persisting the result.
 *
 * Validates the generated HTML via the cache layer's retry mechanism.
 */
export async function renderSection(options: {
  label: string;
  pageId: string;
  model: LanguageModel;
  pageImageBase64: string;
  sectionIndex: number;
  sectionType: string;
  texts: RenderSectionText[];
  images: RenderSectionImage[];
  promptName: string;
  maxRetries?: number;
  skipCache?: boolean;
}): Promise<SectionRendering> {
  const allowedTextIds = options.texts.map((t) => t.text_id);
  const allowedImageIds = options.images.map((img) => img.image_id);

  const response = await cachedPromptGenerateObject<{
    reasoning: string;
    content: string;
  }>({
    label: options.label,
    taskType: "web-rendering",
    pageId: options.pageId,
    model: options.model,
    schema: webRenderingResponseSchema,
    promptName: options.promptName,
    promptContext: {
      page_image_base64: options.pageImageBase64,
      section_type: options.sectionType,
      texts: options.texts,
      images: options.images,
    },
    validate: (result) =>
      validateSectionHtml(result.content, allowedTextIds, allowedImageIds),
    maxRetries: options.maxRetries ?? 2,
    skipCache: options.skipCache,
  });

  return {
    section_index: options.sectionIndex,
    section_type: options.sectionType,
    reasoning: response.reasoning,
    html: response.content,
  };
}
