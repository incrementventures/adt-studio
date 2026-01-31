import { z } from "zod/v4";
import { textTypeKeys, groupTypeKeys } from "../../config";

export const textTypeEnum = z.enum(textTypeKeys);

export const groupTypeEnum = z.enum(groupTypeKeys);

export const textEntrySchema = z.object({
  text_type: textTypeEnum,
  text: z.string(),
  is_pruned: z.boolean().optional(),
});

export const textGroupSchema = z.object({
  group_type: groupTypeEnum,
  texts: z.array(textEntrySchema),
});

export const pageTextExtractionSchema = z.object({
  reasoning: z.string(),
  groups: z.array(textGroupSchema),
});

export type TextEntry = z.infer<typeof textEntrySchema>;
// group_id is stamped after LLM generation, not part of the LLM schema
export type TextGroup = z.infer<typeof textGroupSchema> & { group_id?: string };
export type PageTextExtraction = Omit<z.infer<typeof pageTextExtractionSchema>, "groups"> & {
  groups: TextGroup[];
};

/**
 * Build group summaries for downstream consumers (e.g. page sectioning),
 * filtering out pruned text entries and dropping groups that become empty.
 */
export function buildUnprunedGroupSummaries(
  extraction: PageTextExtraction,
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
