import { z } from "zod/v4";

const sourceRegionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const imageEntrySchema = z.object({
  image_id: z.string(),
  path: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  is_pruned: z.boolean(),
  source_image_id: z.string().optional(),
  source_region: sourceRegionSchema.optional(),
});

export const pageImageClassificationSchema = z.object({
  images: z.array(imageEntrySchema),
});

export type ImageEntry = z.infer<typeof imageEntrySchema>;
export type PageImageClassification = z.infer<
  typeof pageImageClassificationSchema
>;
