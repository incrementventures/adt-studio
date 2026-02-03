/**
 * Image Classification Step
 *
 * Rule-based classification of extracted images based on size filters.
 * No LLM required - this is a pure synchronous function.
 */

import type { PageImage, ImageFilters } from "../core/types";
import type { ImageClassificationOutput } from "../core/schemas";

// ============================================================================
// Input type
// ============================================================================

export interface ClassifyImagesInput {
  pageId: string;
  images: PageImage[];
  filters: ImageFilters;
}

// ============================================================================
// Pure step function
// ============================================================================

/**
 * Classify images based on size filters.
 *
 * Images are pruned if:
 * - They are full-page renders (imageId ends with "_page")
 * - They are smaller than minSide on their shortest dimension
 * - They are larger than maxSide on their longest dimension
 */
export function classifyImages(
  input: ClassifyImagesInput
): ImageClassificationOutput {
  const { pageId, images, filters } = input;

  return {
    images: images.map((img) => {
      const minDim = Math.min(img.width, img.height);
      const maxDim = Math.max(img.width, img.height);

      // Full page renders are always pruned (kept for cropping only)
      if (img.imageId === `${pageId}_page` || img.imageId.endsWith("_page")) {
        return {
          imageId: img.imageId,
          isPruned: true,
          reason: "full-page-render",
        };
      }

      // Check size filters
      if (filters.minSide !== undefined && minDim < filters.minSide) {
        return {
          imageId: img.imageId,
          isPruned: true,
          reason: `too-small: ${minDim}px < ${filters.minSide}px min`,
        };
      }

      if (filters.maxSide !== undefined && maxDim > filters.maxSide) {
        return {
          imageId: img.imageId,
          isPruned: true,
          reason: `too-large: ${maxDim}px > ${filters.maxSide}px max`,
        };
      }

      return {
        imageId: img.imageId,
        isPruned: false,
      };
    }),
  };
}
