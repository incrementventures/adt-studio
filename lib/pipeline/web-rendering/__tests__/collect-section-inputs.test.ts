import { describe, it, expect } from "vitest";
import { collectSectionInputs } from "../collect-section-inputs";
import type { PageSectioning } from "../../page-sectioning/page-sectioning-schema";

function makeSectioning(
  overrides: Partial<PageSectioning> & Pick<PageSectioning, "sections">
): PageSectioning {
  return {
    reasoning: "",
    ...overrides,
  };
}

const IMAGE_MAP = new Map([
  ["pg001_im001", "base64_im001"],
  ["pg001_im002", "base64_im002"],
  ["pg001_im003", "base64_im003"],
]);

describe("collectSectionInputs", () => {
  it("collects unpruned texts and images", () => {
    const sectioning = makeSectioning({
      sections: [
        {
          section_type: "content",
          part_ids: ["pg001_gp001", "pg001_im001"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
      groups: {
        pg001_gp001: {
          group_type: "body",
          texts: [
            { text_type: "paragraph", text: "Hello world", is_pruned: false },
            { text_type: "heading", text: "Title", is_pruned: false },
          ],
        },
      },
      images: {
        pg001_im001: { is_pruned: false },
      },
    });

    const { texts, images } = collectSectionInputs({
      section: sectioning.sections[0],
      sectioning,
      imageMap: IMAGE_MAP,
      pageId: "pg001",
    });

    expect(texts).toEqual([
      { text_id: "pg001_gp001_t001", text_type: "paragraph", text: "Hello world" },
      { text_id: "pg001_gp001_t002", text_type: "heading", text: "Title" },
    ]);
    expect(images).toEqual([
      { image_id: "pg001_im001", image_base64: "base64_im001" },
    ]);
  });

  it("excludes pruned texts within a group", () => {
    const sectioning = makeSectioning({
      sections: [
        {
          section_type: "content",
          part_ids: ["pg001_gp001"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
      groups: {
        pg001_gp001: {
          group_type: "body",
          texts: [
            { text_type: "paragraph", text: "Keep me", is_pruned: false },
            { text_type: "noise", text: "Remove me", is_pruned: true },
            { text_type: "paragraph", text: "Keep me too", is_pruned: false },
          ],
        },
      },
    });

    const { texts } = collectSectionInputs({
      section: sectioning.sections[0],
      sectioning,
      imageMap: IMAGE_MAP,
      pageId: "pg001",
    });

    expect(texts).toEqual([
      { text_id: "pg001_gp001_t001", text_type: "paragraph", text: "Keep me" },
      { text_id: "pg001_gp001_t003", text_type: "paragraph", text: "Keep me too" },
    ]);
  });

  it("excludes an entire pruned group", () => {
    const sectioning = makeSectioning({
      sections: [
        {
          section_type: "content",
          part_ids: ["pg001_gp001", "pg001_gp002"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
      groups: {
        pg001_gp001: {
          group_type: "body",
          is_pruned: true,
          texts: [
            { text_type: "paragraph", text: "Should not appear", is_pruned: false },
          ],
        },
        pg001_gp002: {
          group_type: "body",
          texts: [
            { text_type: "paragraph", text: "Visible", is_pruned: false },
          ],
        },
      },
    });

    const { texts } = collectSectionInputs({
      section: sectioning.sections[0],
      sectioning,
      imageMap: IMAGE_MAP,
      pageId: "pg001",
    });

    expect(texts).toEqual([
      { text_id: "pg001_gp002_t001", text_type: "paragraph", text: "Visible" },
    ]);
  });

  it("excludes pruned images", () => {
    const sectioning = makeSectioning({
      sections: [
        {
          section_type: "content",
          part_ids: ["pg001_im001", "pg001_im002", "pg001_im003"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
      images: {
        pg001_im001: { is_pruned: false },
        pg001_im002: { is_pruned: true },
        pg001_im003: { is_pruned: false },
      },
    });

    const { images } = collectSectionInputs({
      section: sectioning.sections[0],
      sectioning,
      imageMap: IMAGE_MAP,
      pageId: "pg001",
    });

    expect(images).toEqual([
      { image_id: "pg001_im001", image_base64: "base64_im001" },
      { image_id: "pg001_im003", image_base64: "base64_im003" },
    ]);
  });

  it("excludes pruned groups, pruned texts, and pruned images together", () => {
    const sectioning = makeSectioning({
      sections: [
        {
          section_type: "content",
          part_ids: ["pg001_gp001", "pg001_gp002", "pg001_im001", "pg001_im002"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
      groups: {
        pg001_gp001: {
          group_type: "header",
          is_pruned: true,
          texts: [
            { text_type: "heading", text: "Pruned group", is_pruned: false },
          ],
        },
        pg001_gp002: {
          group_type: "body",
          texts: [
            { text_type: "paragraph", text: "Kept", is_pruned: false },
            { text_type: "noise", text: "Pruned text", is_pruned: true },
          ],
        },
      },
      images: {
        pg001_im001: { is_pruned: true },
        pg001_im002: { is_pruned: false },
      },
    });

    const { texts, images } = collectSectionInputs({
      section: sectioning.sections[0],
      sectioning,
      imageMap: IMAGE_MAP,
      pageId: "pg001",
    });

    expect(texts).toEqual([
      { text_id: "pg001_gp002_t001", text_type: "paragraph", text: "Kept" },
    ]);
    expect(images).toEqual([
      { image_id: "pg001_im002", image_base64: "base64_im002" },
    ]);
  });

  it("returns empty when all parts are pruned", () => {
    const sectioning = makeSectioning({
      sections: [
        {
          section_type: "content",
          part_ids: ["pg001_gp001", "pg001_im001"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
      groups: {
        pg001_gp001: {
          group_type: "body",
          is_pruned: true,
          texts: [
            { text_type: "paragraph", text: "Gone", is_pruned: false },
          ],
        },
      },
      images: {
        pg001_im001: { is_pruned: true },
      },
    });

    const { texts, images } = collectSectionInputs({
      section: sectioning.sections[0],
      sectioning,
      imageMap: IMAGE_MAP,
      pageId: "pg001",
    });

    expect(texts).toEqual([]);
    expect(images).toEqual([]);
  });

  it("skips images not present in imageMap even if unpruned", () => {
    const sectioning = makeSectioning({
      sections: [
        {
          section_type: "content",
          part_ids: ["pg001_im099"],
          background_color: "#fff",
          text_color: "#000",
          page_number: 1,
          is_pruned: false,
        },
      ],
      images: {
        pg001_im099: { is_pruned: false },
      },
    });

    const { images } = collectSectionInputs({
      section: sectioning.sections[0],
      sectioning,
      imageMap: IMAGE_MAP,
      pageId: "pg001",
    });

    expect(images).toEqual([]);
  });
});
