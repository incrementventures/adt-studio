import { describe, it, expect } from "vitest";
import { bookMetadataSchema } from "../metadata-schema";

describe("bookMetadataSchema", () => {
  it("parses a fully populated metadata object", () => {
    const input = {
      title: "The Raven",
      authors: ["Edgar Allan Poe"],
      publisher: "Wiley & Putnam",
      language_code: "en",
      cover_page_number: 1,
      reasoning: "The cover is on page 1 with the title prominently displayed.",
    };

    const result = bookMetadataSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("parses metadata with nullable fields set to null", () => {
    const input = {
      title: null,
      authors: [],
      publisher: null,
      language_code: null,
      cover_page_number: null,
      reasoning: "No clear metadata could be extracted.",
    };

    const result = bookMetadataSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("parses metadata with multiple authors", () => {
    const input = {
      title: "A Book",
      authors: ["Author One", "Author Two", "Author Three"],
      publisher: "Publisher Inc",
      language_code: "es",
      cover_page_number: 2,
      reasoning: "Multiple authors found on the title page.",
    };

    const result = bookMetadataSchema.parse(input);
    expect(result.authors).toHaveLength(3);
  });

  it("rejects missing required fields", () => {
    expect(() => bookMetadataSchema.parse({})).toThrow();
    expect(() => bookMetadataSchema.parse({ title: "Hi" })).toThrow();
  });

  it("rejects invalid types", () => {
    const input = {
      title: "T",
      authors: "not an array",
      publisher: null,
      language_code: null,
      cover_page_number: null,
      reasoning: "r",
    };

    expect(() => bookMetadataSchema.parse(input)).toThrow();
  });

  it("rejects non-integer cover page number", () => {
    const input = {
      title: "T",
      authors: [],
      publisher: null,
      language_code: null,
      cover_page_number: 2.7,
      reasoning: "r",
    };

    expect(() => bookMetadataSchema.parse(input)).toThrow();
  });
});
