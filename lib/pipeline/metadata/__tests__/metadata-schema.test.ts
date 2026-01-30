import { describe, it, expect } from "vitest";
import { bookMetadataSchema } from "../metadata-schema.js";

describe("bookMetadataSchema", () => {
  it("parses a fully populated metadata object", () => {
    const input = {
      title: "The Raven",
      authors: ["Edgar Allan Poe"],
      publisher: "Wiley & Putnam",
      language_code: "en",
      cover_page_number: 1,
      table_of_contents: [
        { title: "Chapter 1", page_number: 5 },
        { title: "Chapter 2", page_number: 12 },
      ],
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
      table_of_contents: null,
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
      table_of_contents: null,
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
      table_of_contents: null,
      reasoning: "r",
    };

    expect(() => bookMetadataSchema.parse(input)).toThrow();
  });

  it("rejects non-integer page numbers in TOC", () => {
    const input = {
      title: "T",
      authors: [],
      publisher: null,
      language_code: null,
      cover_page_number: null,
      table_of_contents: [{ title: "Ch 1", page_number: 1.5 }],
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
      table_of_contents: null,
      reasoning: "r",
    };

    expect(() => bookMetadataSchema.parse(input)).toThrow();
  });
});
