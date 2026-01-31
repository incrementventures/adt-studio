import type { LanguageModel } from "ai";
import { cachedPromptGenerateObject } from "@/lib/pipeline/cache";
import { webRenderingResponseSchema } from "./web-rendering-schema";

export interface Annotation {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/**
 * Pure function: calls the LLM to edit an existing HTML section based on
 * spatial annotations drawn by the user.
 */
export async function editSection(options: {
  model: LanguageModel;
  currentHtml: string;
  annotationImageBase64: string;
  annotations: Annotation[];
  cacheDir: string;
}): Promise<{ reasoning: string; html: string }> {
  const response = await cachedPromptGenerateObject<{
    reasoning: string;
    content: string;
  }>({
    model: options.model,
    schema: webRenderingResponseSchema,
    promptName: "web_edit_section",
    promptContext: {
      annotation_image_base64: options.annotationImageBase64,
      annotations: options.annotations,
      current_html: options.currentHtml,
    },
    cacheDir: options.cacheDir,
  });

  return {
    reasoning: response.reasoning,
    html: response.content,
  };
}
