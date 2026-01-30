import { z } from "zod/v4";

export const tocEntrySchema = z.object({
  title: z.string(),
  page_number: z.int(),
});

export const bookMetadataSchema = z.object({
  title: z.string().nullable(),
  authors: z.array(z.string()),
  publisher: z.string().nullable(),
  language_code: z.string().nullable(),
  cover_page_number: z.int().nullable(),
  table_of_contents: z
    .array(tocEntrySchema)
    .nullable(),
  reasoning: z.string(),
});

export type TocEntry = z.infer<typeof tocEntrySchema>;
export type BookMetadata = z.infer<typeof bookMetadataSchema>;
