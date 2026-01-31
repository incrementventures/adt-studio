import { z } from "zod/v4";
import { textTypeKeys, groupTypeKeys } from "../../config.js";

export const textTypeEnum = z.enum(textTypeKeys);

export const groupTypeEnum = z.enum(groupTypeKeys);

export const textEntrySchema = z.object({
  text_type: textTypeEnum,
  text: z.string(),
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
export type TextGroup = z.infer<typeof textGroupSchema>;
export type PageTextExtraction = z.infer<typeof pageTextExtractionSchema>;
