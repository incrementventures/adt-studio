import { z } from "zod/v4";
import { textTypeKeys, groupTypeKeys } from "../../config";

export const textTypeEnum = z.enum(textTypeKeys);

export const groupTypeEnum = z.enum(groupTypeKeys);

export const textEntrySchema = z.object({
  text_type: textTypeEnum,
  text: z.string(),
  is_pruned: z.boolean().default(false),
});

export const textGroupSchema = z.object({
  group_type: groupTypeEnum,
  texts: z.array(textEntrySchema),
});

export const pageTextClassificationSchema = z.object({
  reasoning: z.string(),
  groups: z.array(textGroupSchema),
});

/** Schema sent to the LLM — no is_pruned (applied post-generation). */
const llmTextEntrySchema = z.object({
  text_type: textTypeEnum,
  text: z.string(),
});

const llmTextGroupSchema = z.object({
  group_type: groupTypeEnum,
  texts: z.array(llmTextEntrySchema),
});

export const llmPageTextClassificationSchema = z.object({
  reasoning: z.string(),
  groups: z.array(llmTextGroupSchema),
});

export type TextEntry = z.infer<typeof textEntrySchema>;
// group_id is stamped after LLM generation, not part of the LLM schema
export type TextGroup = z.infer<typeof textGroupSchema> & { group_id?: string };
export type PageTextClassification = Omit<z.infer<typeof pageTextClassificationSchema>, "groups"> & {
  groups: TextGroup[];
};

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
