import { z } from "zod/v4";

export const webRenderingResponseSchema = z.object({
  reasoning: z.string(),
  content: z.string(),
});

export interface SectionRendering {
  section_index: number;
  section_type: string;
  reasoning: string;
  html: string;
}

export interface WebRendering {
  sections: SectionRendering[];
  page_sectioning_version?: number;
}
