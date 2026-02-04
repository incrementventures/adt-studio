/**
 * Zod schemas for pipeline step inputs and outputs.
 *
 * These schemas define the contracts between steps and are used for:
 * - Runtime validation of LLM outputs
 * - TypeScript type inference
 * - Storage serialization
 */

import { z } from "zod/v4";

// ============================================================================
// Image Classification
// ============================================================================

export const imageClassificationResultSchema = z.object({
  imageId: z.string(),
  isPruned: z.boolean(),
  reason: z.string().optional(),
});

export const imageClassificationOutputSchema = z.object({
  images: z.array(imageClassificationResultSchema),
});

export type ImageClassificationOutput = z.infer<
  typeof imageClassificationOutputSchema
>;

// ============================================================================
// Text Classification
// ============================================================================

export const textEntrySchema = z.object({
  textType: z.string(),
  text: z.string(),
  isPruned: z.boolean(),
});

export const textGroupSchema = z.object({
  groupId: z.string(),
  groupType: z.string(),
  texts: z.array(textEntrySchema),
});

export const textClassificationOutputSchema = z.object({
  reasoning: z.string(),
  groups: z.array(textGroupSchema),
});

export type TextEntry = z.infer<typeof textEntrySchema>;
export type TextGroup = z.infer<typeof textGroupSchema>;
export type TextClassificationOutput = z.infer<
  typeof textClassificationOutputSchema
>;

/**
 * Build an LLM-facing schema with enum-constrained types.
 * The LLM sees restricted enums; we store with string types for flexibility.
 */
export function buildTextClassificationLLMSchema(
  textTypes: [string, ...string[]],
  groupTypes: [string, ...string[]]
) {
  return z.object({
    reasoning: z.string(),
    groups: z.array(
      z.object({
        group_type: z.enum(groupTypes),
        texts: z.array(
          z.object({
            text_type: z.enum(textTypes),
            text: z.string(),
          })
        ),
      })
    ),
  });
}

// ============================================================================
// Page Sectioning
// ============================================================================

export const sectionSchema = z.object({
  sectionType: z.string(),
  partIds: z.array(z.string()), // References to group IDs or image IDs
  backgroundColor: z.string(),
  textColor: z.string(),
  pageNumber: z.number().int().nullable(),
  isPruned: z.boolean(),
  // Resolved content (populated when reading from storage)
  texts: z
    .array(z.object({ textId: z.string(), textType: z.string(), text: z.string() }))
    .optional(),
  imageIds: z.array(z.string()).optional(),
});

export const pageSectioningOutputSchema = z.object({
  reasoning: z.string(),
  sections: z.array(sectionSchema),
});

export type Section = z.infer<typeof sectionSchema>;
export type PageSectioningOutput = z.infer<typeof pageSectioningOutputSchema>;

/**
 * Build an LLM-facing schema with enum-constrained section types and part IDs.
 */
export function buildPageSectioningLLMSchema(
  sectionTypes: [string, ...string[]],
  validPartIds: [string, ...string[]]
) {
  return z.object({
    reasoning: z.string(),
    sections: z.array(
      z.object({
        section_type: z.enum(sectionTypes),
        part_ids: z.array(z.enum(validPartIds)),
        background_color: z.string(),
        text_color: z.string(),
        page_number: z.number().int().nullable(),
      })
    ),
  });
}

// ============================================================================
// Web Rendering
// ============================================================================

export const sectionRenderingSchema = z.object({
  sectionIndex: z.number().int(),
  sectionType: z.string(),
  reasoning: z.string(),
  html: z.string(),
});

export const webRenderingOutputSchema = z.object({
  sections: z.array(sectionRenderingSchema),
});

export type SectionRendering = z.infer<typeof sectionRenderingSchema>;
export type WebRenderingOutput = z.infer<typeof webRenderingOutputSchema>;

/**
 * LLM response schema for rendering a single section.
 */
export const webRenderingLLMResponseSchema = z.object({
  reasoning: z.string(),
  content: z.string(),
});

// ============================================================================
// Section Edit (for annotation-based edits)
// ============================================================================

export const sectionEditOutputSchema = z.object({
  reasoning: z.string(),
  html: z.string(),
});

export type SectionEditOutput = z.infer<typeof sectionEditOutputSchema>;

// ============================================================================
// DB format converters (for compatibility with existing storage)
// ============================================================================

/**
 * Convert new schema format to DB storage format.
 * Used to maintain compatibility with existing data.
 */
export function toDBTextClassification(output: TextClassificationOutput): {
  reasoning: string;
  groups: Array<{
    group_id: string;
    group_type: string;
    texts: Array<{ text_type: string; text: string; is_pruned: boolean }>;
  }>;
} {
  return {
    reasoning: output.reasoning,
    groups: output.groups.map((g) => ({
      group_id: g.groupId,
      group_type: g.groupType,
      texts: g.texts.map((t) => ({
        text_type: t.textType,
        text: t.text,
        is_pruned: t.isPruned,
      })),
    })),
  };
}

/**
 * Convert DB storage format to new schema format.
 */
export function fromDBTextClassification(db: {
  reasoning: string;
  groups: Array<{
    group_id?: string;
    group_type: string;
    texts: Array<{ text_type: string; text: string; is_pruned: boolean }>;
  }>;
}): TextClassificationOutput {
  return {
    reasoning: db.reasoning,
    groups: db.groups.map((g, idx) => ({
      groupId: g.group_id ?? `gp${String(idx + 1).padStart(3, "0")}`,
      groupType: g.group_type,
      texts: g.texts.map((t) => ({
        textType: t.text_type,
        text: t.text,
        isPruned: t.is_pruned,
      })),
    })),
  };
}

export function toDBImageClassification(
  output: ImageClassificationOutput
): {
  images: Array<{
    image_id: string;
    path: string;
    is_pruned: boolean;
  }>;
} {
  return {
    images: output.images.map((img) => ({
      image_id: img.imageId,
      path: `images/${img.imageId}.png`,
      is_pruned: img.isPruned,
    })),
  };
}

export function fromDBImageClassification(db: {
  images: Array<{
    image_id: string;
    path: string;
    is_pruned: boolean;
  }>;
}): ImageClassificationOutput {
  return {
    images: db.images.map((img) => ({
      imageId: img.image_id,
      isPruned: img.is_pruned,
    })),
  };
}

export function toDBPageSectioning(
  output: PageSectioningOutput,
  textClassification: TextClassificationOutput,
  imageClassification: ImageClassificationOutput,
  textClassificationVersion: number,
  imageClassificationVersion: number
): {
  reasoning: string;
  sections: Array<{
    section_type: string;
    part_ids: string[];
    background_color: string;
    text_color: string;
    page_number: number | null;
    is_pruned: boolean;
  }>;
  text_classification_version: number;
  image_classification_version: number;
  groups: Record<
    string,
    {
      group_type: string;
      is_pruned?: boolean;
      texts: Array<{ text_type: string; text: string; is_pruned: boolean }>;
    }
  >;
  images: Record<string, { is_pruned: boolean }>;
} {
  // Build groups record
  const assignedPartIds = new Set(output.sections.flatMap((s) => s.partIds));
  const groups: Record<
    string,
    {
      group_type: string;
      is_pruned?: boolean;
      texts: Array<{ text_type: string; text: string; is_pruned: boolean }>;
    }
  > = {};
  for (const g of textClassification.groups) {
    groups[g.groupId] = {
      group_type: g.groupType,
      is_pruned: !assignedPartIds.has(g.groupId),
      texts: g.texts.map((t) => ({
        text_type: t.textType,
        text: t.text,
        is_pruned: t.isPruned,
      })),
    };
  }

  // Build images record
  const images: Record<string, { is_pruned: boolean }> = {};
  for (const img of imageClassification.images) {
    if (!img.isPruned) {
      images[img.imageId] = { is_pruned: !assignedPartIds.has(img.imageId) };
    }
  }

  return {
    reasoning: output.reasoning,
    sections: output.sections.map((s) => ({
      section_type: s.sectionType,
      part_ids: s.partIds,
      background_color: s.backgroundColor,
      text_color: s.textColor,
      page_number: s.pageNumber,
      is_pruned: s.isPruned,
    })),
    text_classification_version: textClassificationVersion,
    image_classification_version: imageClassificationVersion,
    groups,
    images,
  };
}

export function fromDBPageSectioning(db: {
  reasoning: string;
  sections: Array<{
    section_type: string;
    part_ids: string[];
    background_color: string;
    text_color: string;
    page_number: number | null;
    is_pruned: boolean;
  }>;
  groups?: Record<
    string,
    {
      group_type: string;
      texts: Array<{ text_type: string; text: string; is_pruned: boolean }>;
    }
  >;
  images?: Record<string, { is_pruned: boolean }>;
}): PageSectioningOutput {
  const groups = db.groups ?? {};
  const embeddedImages = db.images ?? {};

  return {
    reasoning: db.reasoning,
    sections: db.sections.map((s) => {
      // Resolve texts and images for this section
      const texts: Array<{ textId: string; textType: string; text: string }> = [];
      const imageIds: string[] = [];

      for (const partId of s.part_ids) {
        const group = groups[partId];
        if (group) {
          group.texts.forEach((t, ti) => {
            if (t.is_pruned) return;
            texts.push({
              textId: `${partId}_t${String(ti + 1).padStart(3, "0")}`,
              textType: t.text_type,
              text: t.text,
            });
          });
          continue;
        }

        const img = embeddedImages[partId];
        if (img && !img.is_pruned) {
          imageIds.push(partId);
        }
      }

      return {
        sectionType: s.section_type,
        partIds: s.part_ids,
        backgroundColor: s.background_color,
        textColor: s.text_color,
        pageNumber: s.page_number,
        isPruned: s.is_pruned,
        texts,
        imageIds,
      };
    }),
  };
}

export function toDBSectionRendering(output: SectionRendering): {
  section_index: number;
  section_type: string;
  reasoning: string;
  html: string;
} {
  return {
    section_index: output.sectionIndex,
    section_type: output.sectionType,
    reasoning: output.reasoning,
    html: output.html,
  };
}

export function fromDBSectionRendering(db: {
  section_index: number;
  section_type: string;
  reasoning: string;
  html: string;
}): SectionRendering {
  return {
    sectionIndex: db.section_index,
    sectionType: db.section_type,
    reasoning: db.reasoning,
    html: db.html,
  };
}
