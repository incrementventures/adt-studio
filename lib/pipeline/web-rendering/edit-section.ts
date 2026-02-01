import type { LanguageModel } from "ai";
import type { ValidationResult } from "@/lib/pipeline/cache";
import { cachedPromptGenerateObject } from "@/lib/pipeline/cache";
import { webRenderingResponseSchema } from "./web-rendering-schema";
import { validateSectionHtml } from "./validate-html";

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
 *
 * When allowedTextIds/allowedImageIds are provided, validates the generated
 * HTML via the cache layer's retry mechanism.
 */
export async function editSection(options: {
  model: LanguageModel;
  currentHtml: string;
  annotationImageBase64: string;
  annotations: Annotation[];
  cacheDir: string;
  allowedTextIds?: string[];
  allowedImageIds?: string[];
  maxRetries?: number;
}): Promise<{ reasoning: string; html: string }> {
  const hasValidation =
    options.allowedTextIds !== undefined ||
    options.allowedImageIds !== undefined;

  const validate = hasValidation
    ? (result: { content: string }): ValidationResult =>
        validateSectionHtml(
          result.content,
          options.allowedTextIds ?? [],
          options.allowedImageIds ?? [],
        )
    : undefined;

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
    validate,
    maxRetries: options.maxRetries ?? 2,
  });

  return {
    reasoning: response.reasoning,
    html: response.content,
  };
}
