import { z } from "zod/v4";

export const bookMetadataSchema = z.object({
  title: z.string().nullable(),
  authors: z.array(z.string()),
  publisher: z.string().nullable(),
  language_code: z.string().nullable(),
  cover_page_number: z.int().nullable(),
  reasoning: z.string(),
});

export type BookMetadata = z.infer<typeof bookMetadataSchema>;
