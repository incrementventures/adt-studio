import { describe, it, expect } from "vitest";
import { pageTextClassificationSchema } from "../text-classification-schema";

describe("pageTextClassificationSchema", () => {
  it("parses a fully populated object", () => {
    const input = {
      reasoning: "Page contains a heading and two paragraphs of body text.",
      groups: [
        {
          group_type: "heading",
          texts: [
            { text_type: "section_heading", text: "Chapter 1: The Beginning", is_pruned: false },
          ],
        },
        {
          group_type: "paragraph",
          texts: [
            { text_type: "section_text", text: "It was a dark and stormy night.", is_pruned: false },
            { text_type: "section_text", text: "The wind howled through the trees.", is_pruned: false },
          ],
        },
        {
          group_type: "other",
          texts: [
            { text_type: "page_number", text: "42", is_pruned: false },
          ],
        },
      ],
    };

    const result = pageTextClassificationSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("defaults is_pruned to false when omitted", () => {
    const input = {
      reasoning: "test",
      groups: [
        {
          group_type: "paragraph",
          texts: [{ text_type: "section_text", text: "hello" }],
        },
      ],
    };

    const result = pageTextClassificationSchema.parse(input);
    expect(result.groups[0].texts[0].is_pruned).toBe(false);
  });

  it("parses empty groups (blank page)", () => {
    const input = {
      reasoning: "This page is blank.",
      groups: [],
    };

    const result = pageTextClassificationSchema.parse(input);
    expect(result.groups).toHaveLength(0);
  });

  it("rejects invalid text_type", () => {
    const input = {
      reasoning: "test",
      groups: [
        {
          group_type: "paragraph",
          texts: [{ text_type: "invalid_type", text: "hello" }],
        },
      ],
    };

    expect(() => pageTextClassificationSchema.parse(input)).toThrow();
  });

  it("rejects invalid group_type", () => {
    const input = {
      reasoning: "test",
      groups: [
        {
          group_type: "invalid_group",
          texts: [{ text_type: "section_text", text: "hello" }],
        },
      ],
    };

    expect(() => pageTextClassificationSchema.parse(input)).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => pageTextClassificationSchema.parse({})).toThrow();
    expect(() =>
      pageTextClassificationSchema.parse({ reasoning: "test" })
    ).toThrow();
    expect(() =>
      pageTextClassificationSchema.parse({ groups: [] })
    ).toThrow();
  });
});
