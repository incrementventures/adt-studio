/**
 * Text Classification Step
 *
 * Classifies text on a page into typed groups using an LLM.
 * Groups text by semantic meaning (paragraphs, headers, lists, etc.)
 * and assigns text types (body, heading, caption, etc.) to each entry.
 */

import type { Page, LLMModel, TypeDef, Message } from "../core/types";
import {
  type TextClassificationOutput,
  buildTextClassificationLLMSchema,
} from "../core/schemas";
import { loadPrompt } from "../core/llm";

// ============================================================================
// Input type
// ============================================================================

export interface ClassifyTextInput {
  page: Page;
  language: string;
  textTypes: TypeDef[];
  textGroupTypes: TypeDef[];
  prunedTextTypes: string[];
  model: LLMModel;
  promptName: string;
}

// ============================================================================
// Raw LLM response type (before post-processing)
// ============================================================================

interface RawTextClassification {
  reasoning: string;
  groups: Array<{
    group_type: string;
    texts: Array<{ text_type: string; text: string }>;
  }>;
}

// ============================================================================
// Pure step function
// ============================================================================

/**
 * Classify text on a page into typed groups.
 *
 * This is a pure async function that:
 * 1. Builds the LLM schema from configured types
 * 2. Renders the prompt template
 * 3. Calls the LLM
 * 4. Post-processes to assign IDs and mark pruned entries
 */
export async function classifyText(
  input: ClassifyTextInput
): Promise<TextClassificationOutput> {
  const {
    page,
    language,
    textTypes,
    textGroupTypes,
    prunedTextTypes,
    model,
    promptName,
  } = input;

  // Build schema with enum constraints from config
  const textTypeKeys = textTypes.map((t) => t.key);
  const groupTypeKeys = textGroupTypes.map((t) => t.key);

  if (textTypeKeys.length === 0) {
    throw new Error("No text types configured");
  }
  if (groupTypeKeys.length === 0) {
    throw new Error("No text group types configured");
  }

  const schema = buildTextClassificationLLMSchema(
    textTypeKeys as [string, ...string[]],
    groupTypeKeys as [string, ...string[]]
  );

  // Build prompt context
  const promptContext = {
    page: {
      pageNumber: page.pageNumber,
      text: page.rawText,
      imageBase64: page.pageImageBase64,
    },
    language,
    text_types: textTypes,
    text_group_types: textGroupTypes,
  };

  // Load and render the prompt
  const { system, messages } = await loadPrompt(promptName, promptContext);

  // Call LLM
  const result = await model.generateObject<RawTextClassification>({
    schema,
    system,
    messages,
    log: {
      taskType: "text-classification",
      pageId: page.pageId,
      promptName,
    },
  });

  // Post-process: assign IDs and mark pruned entries
  const prunedSet = new Set(prunedTextTypes);

  const groups = result.object.groups.map((g, idx) => ({
    groupId: `${page.pageId}_gp${String(idx + 1).padStart(3, "0")}`,
    groupType: g.group_type,
    texts: g.texts.map((t) => ({
      textType: t.text_type,
      text: t.text,
      isPruned: prunedSet.has(t.text_type),
    })),
  }));

  return {
    reasoning: result.object.reasoning,
    groups,
  };
}

// ============================================================================
// Helper functions for downstream steps
// ============================================================================

/**
 * Build group summaries for page sectioning, excluding pruned text entries.
 */
export function buildGroupSummaries(
  textClassification: TextClassificationOutput,
): Array<{ groupId: string; groupType: string; text: string }> {
  return textClassification.groups
    .map((g) => {
      const unprunedTexts = g.texts.filter((t) => !t.isPruned);
      if (unprunedTexts.length === 0) return null;

      return {
        groupId: g.groupId,
        groupType: g.groupType,
        text: unprunedTexts.map((t) => t.text).join(" "),
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);
}
