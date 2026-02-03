/**
 * Page Sectioning Step
 *
 * Groups classified text and images into semantic sections using an LLM.
 * Sections represent logical parts of the page (title blocks, body text,
 * figures, etc.) that will be rendered separately.
 */

import type { Page, PageImage, LLMModel, TypeDef } from "../core/types";
import {
  type TextClassificationOutput,
  type ImageClassificationOutput,
  type PageSectioningOutput,
  buildPageSectioningLLMSchema,
} from "../core/schemas";
import { loadPrompt } from "../core/llm";
import { buildGroupSummaries } from "./text-classification";

// ============================================================================
// Input type
// ============================================================================

export interface SectionPageInput {
  page: Page;
  textClassification: TextClassificationOutput;
  imageClassification: ImageClassificationOutput;
  images: PageImage[]; // All extracted images (will be filtered by classification)
  sectionTypes: TypeDef[];
  prunedSectionTypes: string[];
  model: LLMModel;
  promptName: string;
}

// ============================================================================
// Raw LLM response type (before post-processing)
// ============================================================================

interface RawPageSectioning {
  reasoning: string;
  sections: Array<{
    section_type: string;
    part_ids: string[];
    background_color: string;
    text_color: string;
    page_number: number | null;
  }>;
}

// ============================================================================
// Pure step function
// ============================================================================

/**
 * Group text and images into semantic sections.
 *
 * This is a pure async function that:
 * 1. Builds group summaries from text classification (excluding pruned)
 * 2. Filters images to only un-pruned ones
 * 3. Builds the LLM schema with valid part IDs
 * 4. Calls the LLM
 * 5. Post-processes to mark pruned sections
 */
export async function sectionPage(
  input: SectionPageInput
): Promise<PageSectioningOutput> {
  const {
    page,
    textClassification,
    imageClassification,
    images,
    sectionTypes,
    prunedSectionTypes,
    model,
    promptName,
  } = input;

  // Build group summaries (excludes pruned text entries)
  const groupSummaries = buildGroupSummaries(textClassification);

  // Filter to un-pruned images
  const prunedImageIds = new Set(
    imageClassification.images
      .filter((img) => img.isPruned)
      .map((img) => img.imageId)
  );
  const unprunedImages = images.filter((img) => !prunedImageIds.has(img.imageId));

  // Build valid part IDs for the schema
  const validPartIds = [
    ...groupSummaries.map((g) => g.groupId),
    ...unprunedImages.map((img) => img.imageId),
  ];

  // If no parts to section, return empty result
  if (validPartIds.length === 0) {
    return { reasoning: "No content to section", sections: [] };
  }

  // Build schema with enum constraints
  const sectionTypeKeys = sectionTypes.map((s) => s.key);
  if (sectionTypeKeys.length === 0) {
    throw new Error("No section types configured");
  }

  const schema = buildPageSectioningLLMSchema(
    sectionTypeKeys as [string, ...string[]],
    validPartIds as [string, ...string[]]
  );

  // Build prompt context
  const promptContext = {
    page: { imageBase64: page.pageImageBase64 },
    images: unprunedImages.map((img) => ({
      image_id: img.imageId,
      imageBase64: img.imageBase64,
    })),
    groups: groupSummaries.map((g) => ({
      group_id: g.groupId,
      group_type: g.groupType,
      text: g.text,
    })),
    section_types: sectionTypes,
  };

  // Load and render the prompt
  const { system, messages } = await loadPrompt(promptName, promptContext);

  // Call LLM
  const result = await model.generateObject<RawPageSectioning>({
    schema,
    system,
    messages,
    log: {
      taskType: "page-sectioning",
      pageId: page.pageId,
      promptName,
    },
  });

  // Post-process: mark pruned sections
  const prunedSet = new Set(prunedSectionTypes);

  const sections = result.object.sections.map((s) => ({
    sectionType: s.section_type,
    partIds: s.part_ids,
    backgroundColor: s.background_color,
    textColor: s.text_color,
    pageNumber: s.page_number,
    isPruned: prunedSet.has(s.section_type),
  }));

  return {
    reasoning: result.object.reasoning,
    sections,
  };
}
