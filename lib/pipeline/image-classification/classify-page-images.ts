import type { PageImageClassification } from "./image-classification-schema";

export interface ImageInput {
  image_id: string;
  path: string;
  buf: Buffer;
}

export interface SizeFilter {
  min_side?: number;
  max_side?: number;
}

/**
 * Read width and height from a PNG IHDR chunk (bytes 16–23).
 */
function pngDimensions(buf: Buffer): { width: number; height: number } {
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

/**
 * Classify page images by applying rule-based size filters.
 * Pure function — no disk I/O.
 */
export function classifyPageImages(
  images: ImageInput[],
  sizeFilter?: SizeFilter
): PageImageClassification {
  return {
    images: images.map((img) => {
      const { width, height } = pngDimensions(img.buf);
      const minDim = Math.min(width, height);
      const maxDim = Math.max(width, height);
      let is_pruned = false;

      if (sizeFilter?.min_side != null && minDim < sizeFilter.min_side) {
        is_pruned = true;
      }
      if (sizeFilter?.max_side != null && maxDim > sizeFilter.max_side) {
        is_pruned = true;
      }

      return { image_id: img.image_id, path: img.path, width, height, is_pruned };
    }),
  };
}
