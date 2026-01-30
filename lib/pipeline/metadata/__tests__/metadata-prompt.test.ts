import { describe, it, expect } from "vitest";
import { renderPrompt } from "../../prompt.js";

const pages = [
  { pageNumber: 1, text: "Page one text", imageBase64: "aW1hZ2UxYmFzZTY0" },
  { pageNumber: 2, text: "Page two text", imageBase64: "aW1hZ2UyYmFzZTY0" },
];

describe("metadata_extraction prompt", () => {
  it("returns system and user messages", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("system message is a plain string", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    expect(typeof messages[0].content).toBe("string");
  });

  it("system message does not mention PDF metadata hints", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    const system = messages[0].content as string;
    expect(system).not.toContain("PDF METADATA HINTS");
    expect(system).not.toContain("pdf_metadata");
  });

  it("system message does not mention cover_page_id", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    const system = messages[0].content as string;
    expect(system).not.toContain("cover_page_id");
  });

  it("user message is an array of content parts", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    expect(Array.isArray(messages[1].content)).toBe(true);
  });

  it("user message interleaves text and image parts per page", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    const parts = messages[1].content as Array<{ type: string }>;

    const imageParts = parts.filter((p) => p.type === "image");
    expect(imageParts).toHaveLength(2);

    const textParts = parts.filter((p) => p.type === "text");
    expect(textParts.length).toBeGreaterThanOrEqual(1);
  });

  it("user message includes page text content", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    const parts = messages[1].content as Array<{
      type: string;
      text?: string;
    }>;
    const allText = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    expect(allText).toContain("Page one text");
    expect(allText).toContain("Page two text");
  });

  it("user message includes image base64 data", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    const parts = messages[1].content as Array<{
      type: string;
      image?: string;
    }>;
    const images = parts.filter((p) => p.type === "image");
    expect(images[0].image).toBe("aW1hZ2UxYmFzZTY0");
    expect(images[1].image).toBe("aW1hZ2UyYmFzZTY0");
  });

  it("user message includes page numbers", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages });
    const parts = messages[1].content as Array<{
      type: string;
      text?: string;
    }>;
    const allText = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    expect(allText).toContain("Page 1");
    expect(allText).toContain("Page 2");
  });

  it("handles empty pages array", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages: [] });
    expect(messages.length).toBe(2);
    const parts = messages[1].content as Array<{ type: string }>;
    const images = parts.filter((p) => p.type === "image");
    expect(images).toHaveLength(0);
  });
});
