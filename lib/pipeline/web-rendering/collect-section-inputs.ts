/**
 * Collect the unpruned texts and images for a single section,
 * honouring group-level, text-level, and image-level pruning from
 * the sectioning's embedded data.
 *
 * Used by both the pipeline node (web-rendering.ts) and the
 * single-page actions (actions.ts) so the pruning logic lives in
 * exactly one place.
 */

import type { PageSectioning } from "../page-sectioning/page-sectioning-schema";
import type { RenderSectionText, RenderSectionImage } from "./render-section";

export interface CollectSectionInputsOptions {
  /** The section whose part_ids to resolve. */
  section: PageSectioning["sections"][number];
  /** Full sectioning data (with embedded groups / images). */
  sectioning: PageSectioning;
  /** image_id → base64 for every available (unpruned-at-extraction) image. */
  imageMap: Map<string, string>;
  /** Page id, used to build stable text_id values. */
  pageId: string;
}

export function collectSectionInputs({
  section,
  sectioning,
  imageMap,
  pageId,
}: CollectSectionInputsOptions): {
  texts: RenderSectionText[];
  images: RenderSectionImage[];
} {
  const texts: RenderSectionText[] = [];
  const images: RenderSectionImage[] = [];

  for (const partId of section.part_ids) {
    // --- group part ---
    const group = sectioning.groups?.[partId];
    if (group) {
      if (group.is_pruned) continue;
      group.texts.forEach((t, ti) => {
        if (t.is_pruned) return;
        texts.push({
          text_id: partId + "_t" + String(ti + 1).padStart(3, "0"),
          text_type: t.text_type,
          text: t.text,
        });
      });
      continue;
    }

    // --- image part ---
    const imgMeta = sectioning.images?.[partId];
    if (imgMeta?.is_pruned) continue;
    const imgBase64 = imageMap.get(partId);
    if (imgBase64) {
      images.push({ image_id: partId, image_base64: imgBase64 });
    }
  }

  return { texts, images };
}
