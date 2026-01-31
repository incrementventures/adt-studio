import type { LanguageModel } from "ai";
import { cachedPromptGenerateObject } from "@/lib/pipeline/cache";
import {
  buildPageSectioningSchema,
  type PageSectioning,
} from "@/lib/pipeline/page-sectioning/page-sectioning-schema";

/**
 * Pure function: runs the page-sectioning LLM call for a single page.
 * No disk reads or writes — the caller is responsible for loading inputs
 * and persisting the result.
 */
export async function sectionPage(options: {
  model: LanguageModel;
  pageImageBase64: string;
  images: { image_id: string; imageBase64: string }[];
  groups: { group_id: string; group_type: string; text: string }[];
  sectionTypes: { key: string; description: string }[];
  promptName: string;
  cacheDir: string;
}): Promise<PageSectioning> {
  const sectionTypeKeys = options.sectionTypes.map((s) => s.key) as [
    string,
    ...string[],
  ];
  if (sectionTypeKeys.length === 0) {
    throw new Error(
      "No section_types provided — cannot run page sectioning"
    );
  }
  const schema = buildPageSectioningSchema(sectionTypeKeys);

  return cachedPromptGenerateObject<PageSectioning>({
    model: options.model,
    schema,
    promptName: options.promptName,
    promptContext: {
      page: { imageBase64: options.pageImageBase64 },
      images: options.images,
      groups: options.groups,
      section_types: options.sectionTypes,
    },
    cacheDir: options.cacheDir,
  });
}
