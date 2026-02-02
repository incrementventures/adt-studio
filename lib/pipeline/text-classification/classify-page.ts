import type { LanguageModel } from "ai";
import type { z } from "zod/v4";
import { cachedPromptGenerateObject } from "@/lib/pipeline/cache";
import {
  type PageTextClassification,
} from "./text-classification-schema";

/**
 * Pure function: runs the text-classification LLM call for a single page.
 * No disk reads or writes — the caller is responsible for loading inputs
 * and persisting the result.
 */
export async function classifyPage(options: {
  label: string;
  model: LanguageModel;
  schema: z.ZodType;
  pageNumber: number;
  pageId: string;
  text: string;
  imageBase64: string;
  language: string;
  textTypes: { key: string; description: string }[];
  textGroupTypes: { key: string; description: string }[];
  prunedTextTypes: string[];
  promptName: string;
  skipCache?: boolean;
}): Promise<PageTextClassification> {
  const page = {
    pageNumber: options.pageNumber,
    text: options.text,
    imageBase64: options.imageBase64,
  };

  const extraction = await cachedPromptGenerateObject<PageTextClassification>({
    label: options.label,
    taskType: "text-classification",
    pageId: options.pageId,
    model: options.model,
    schema: options.schema,
    promptName: options.promptName,
    promptContext: {
      page,
      language: options.language,
      text_types: options.textTypes,
      text_group_types: options.textGroupTypes,
    },
    skipCache: options.skipCache,
  });

  // Assign stable group IDs and default is_pruned
  extraction.groups.forEach((g, idx) => {
    g.group_id =
      options.pageId + "_gp" + String(idx + 1).padStart(3, "0");
    for (const t of g.texts) {
      t.is_pruned = false;
    }
  });

  // Mark pruned text entries based on config
  if (options.prunedTextTypes.length > 0) {
    const prunedSet = new Set(options.prunedTextTypes);
    for (const g of extraction.groups) {
      for (const t of g.texts) {
        if (prunedSet.has(t.text_type)) {
          t.is_pruned = true;
        }
      }
    }
  }

  return extraction;
}
