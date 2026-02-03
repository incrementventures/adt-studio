/**
 * Metadata Extraction Step
 *
 * Extracts book-level metadata (title, authors, language, etc.) from
 * the first few pages using an LLM.
 *
 * This is a book-level step, not a page-level step.
 */

import type { Page, LLMModel } from "../core/types";
import { bookMetadataSchema, type BookMetadata } from "../metadata/metadata-schema";
import { loadPrompt } from "../core/llm";

// Re-export the schema type
export type { BookMetadata } from "../metadata/metadata-schema";

// ============================================================================
// Input type
// ============================================================================

export interface ExtractMetadataInput {
  /** First N pages of the book (typically 3) */
  pages: Page[];
  model: LLMModel;
  promptName: string;
}

// ============================================================================
// Pure step function
// ============================================================================

/**
 * Extract book metadata from the first few pages.
 *
 * This is a pure async function that:
 * 1. Prepares page data for the LLM
 * 2. Calls the LLM with the metadata extraction prompt
 * 3. Returns validated metadata
 */
export async function extractMetadata(
  input: ExtractMetadataInput
): Promise<BookMetadata> {
  const { pages, model, promptName } = input;

  // Build prompt context with page images and text
  const promptContext = {
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.rawText,
      imageBase64: p.pageImageBase64,
    })),
  };

  // Load and render the prompt
  const { system, messages } = await loadPrompt(promptName, promptContext);

  // Call LLM
  const result = await model.generateObject<BookMetadata>({
    schema: bookMetadataSchema,
    system,
    messages,
    log: {
      taskType: "metadata",
      promptName,
    },
  });

  return result.object;
}
