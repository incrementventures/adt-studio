import type { LanguageModel } from "ai";
import { cachedPromptGenerateObject } from "@/lib/pipeline/cache";
import {
  webRenderingResponseSchema,
  type SectionRendering,
} from "./web-rendering-schema";

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
 */
export async function renderSection(options: {
  model: LanguageModel;
  pageImageBase64: string;
  sectionIndex: number;
  sectionType: string;
  texts: RenderSectionText[];
  images: RenderSectionImage[];
  promptName: string;
  cacheDir: string;
}): Promise<SectionRendering> {
  const response = await cachedPromptGenerateObject<{
    reasoning: string;
    content: string;
  }>({
    model: options.model,
    schema: webRenderingResponseSchema,
    promptName: options.promptName,
    promptContext: {
      page_image_base64: options.pageImageBase64,
      section_type: options.sectionType,
      texts: options.texts,
      images: options.images,
    },
    cacheDir: options.cacheDir,
  });

  return {
    section_index: options.sectionIndex,
    section_type: options.sectionType,
    reasoning: response.reasoning,
    html: response.content,
  };
}
