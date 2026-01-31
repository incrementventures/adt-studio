import { z } from "zod/v4";

export function buildPageSectioningSchema(
  sectionTypeKeys: [string, ...string[]],
  validPartIds: [string, ...string[]]
) {
  const sectionTypeEnum = z.enum(sectionTypeKeys);
  const partIdEnum = z.enum(validPartIds);

  const sectionSchema = z.object({
    section_type: sectionTypeEnum,
    part_ids: z.array(partIdEnum),
    background_color: z.string(),
    text_color: z.string(),
    page_number: z.number().int().nullable(),
  });

  return z.object({
    reasoning: z.string(),
    sections: z.array(sectionSchema),
  });
}

export type PageSectioning = {
  reasoning: string;
  sections: Array<{
    section_type: string;
    part_ids: string[];
    background_color: string;
    text_color: string;
    page_number: number | null;
    is_pruned: boolean;
  }>;
  text_classification_version?: number;
  image_classification_version?: number;
};
