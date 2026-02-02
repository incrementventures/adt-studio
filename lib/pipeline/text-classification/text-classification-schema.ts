import { z } from "zod/v4";

// Storage schemas — use z.string() so stored data can contain types from any book's config.
export const textEntrySchema = z.object({
  text_type: z.string(),
  text: z.string(),
  is_pruned: z.boolean().default(false),
});

export const textGroupSchema = z.object({
  group_type: z.string(),
  texts: z.array(textEntrySchema),
});

export const pageTextClassificationSchema = z.object({
  reasoning: z.string(),
  groups: z.array(textGroupSchema),
});

/**
 * Build an LLM-facing text-classification schema with enum-constrained
 * text_type and group_type fields (same pattern as buildPageSectioningSchema).
 */
export function buildLlmTextClassificationSchema(
  textTypes: [string, ...string[]],
  groupTypes: [string, ...string[]]
) {
  const textTypeEnum = z.enum(textTypes);
  const groupTypeEnum = z.enum(groupTypes);

  const llmTextEntrySchema = z.object({
    text_type: textTypeEnum,
    text: z.string(),
  });

  const llmTextGroupSchema = z.object({
    group_type: groupTypeEnum,
    texts: z.array(llmTextEntrySchema),
  });

  return z.object({
    reasoning: z.string(),
    groups: z.array(llmTextGroupSchema),
  });
}

export type TextEntry = z.infer<typeof textEntrySchema>;
// group_id is stamped after LLM generation, not part of the LLM schema
export type TextGroup = z.infer<typeof textGroupSchema> & { group_id?: string };
export type PageTextClassification = Omit<z.infer<typeof pageTextClassificationSchema>, "groups"> & {
  groups: TextGroup[];
};

/**
 * Build a Record of all groups with full text data for embedding in
 * downstream node_data (e.g. page-sectioning).
 */
export function buildGroupsRecord(
  extraction: PageTextClassification,
  pageId: string
): Record<string, { group_type: string; is_pruned?: boolean; texts: { text_type: string; text: string; is_pruned: boolean }[] }> {
  const record: Record<string, { group_type: string; is_pruned?: boolean; texts: { text_type: string; text: string; is_pruned: boolean }[] }> = {};
  for (const [idx, g] of extraction.groups.entries()) {
    const groupId =
      g.group_id ?? pageId + "_gp" + String(idx + 1).padStart(3, "0");
    record[groupId] = {
      group_type: g.group_type,
      texts: g.texts.map((t) => ({
        text_type: t.text_type,
        text: t.text,
        is_pruned: t.is_pruned,
      })),
    };
  }
  return record;
}

/**
 * Build group summaries for downstream consumers (e.g. page sectioning),
 * filtering out pruned text entries and dropping groups that become empty.
 */
export function buildUnprunedGroupSummaries(
  extraction: PageTextClassification,
  pageId: string
): { group_id: string; group_type: string; text: string }[] {
  return extraction.groups.flatMap((g, idx) => {
    const groupId =
      g.group_id ?? pageId + "_gp" + String(idx + 1).padStart(3, "0");
    const unpruned = g.texts.filter((t) => !t.is_pruned);
    if (unpruned.length === 0) return [];
    const text = unpruned.map((t) => t.text).join(" ");
    return [{ group_id: groupId, group_type: g.group_type, text }];
  });
}
