import { describe, it, expect } from "vitest";
import { pageTextExtractionSchema } from "../text-extraction-schema.js";

describe("pageTextExtractionSchema", () => {
  it("parses a fully populated object", () => {
    const input = {
      reasoning: "Page contains a heading and two paragraphs of body text.",
      groups: [
        {
          group_type: "heading",
          texts: [
            { text_type: "section_heading", text: "Chapter 1: The Beginning" },
          ],
        },
        {
          group_type: "paragraph",
          texts: [
            { text_type: "section_text", text: "It was a dark and stormy night." },
            { text_type: "section_text", text: "The wind howled through the trees." },
          ],
        },
        {
          group_type: "other",
          texts: [
            { text_type: "page_number", text: "42" },
          ],
        },
      ],
    };

    const result = pageTextExtractionSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("parses empty groups (blank page)", () => {
    const input = {
      reasoning: "This page is blank.",
      groups: [],
    };

    const result = pageTextExtractionSchema.parse(input);
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

    expect(() => pageTextExtractionSchema.parse(input)).toThrow();
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

    expect(() => pageTextExtractionSchema.parse(input)).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => pageTextExtractionSchema.parse({})).toThrow();
    expect(() =>
      pageTextExtractionSchema.parse({ reasoning: "test" })
    ).toThrow();
    expect(() =>
      pageTextExtractionSchema.parse({ groups: [] })
    ).toThrow();
  });
});
