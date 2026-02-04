import { describe, it, expect } from "vitest";
import { renderPrompt } from "../prompt";

describe("renderPrompt", () => {
  it("renders the metadata_extraction template", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages: [] });
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("substitutes variables into the template", async () => {
    const pages = [
      { pageNumber: 7, text: "Hello world", imageBase64: "abc123" },
    ];
    const messages = await renderPrompt("metadata_extraction", { pages });
    const userParts = messages[1].content as Array<{
      type: string;
      text?: string;
      image?: string;
    }>;

    const allText = userParts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    expect(allText).toContain("Page 7");
    expect(allText).toContain("Hello world");

    const images = userParts.filter((p) => p.type === "image");
    expect(images[0].image).toBe("abc123");
  });

  it("system content is a trimmed string", async () => {
    const messages = await renderPrompt("metadata_extraction", { pages: [] });
    const system = messages[0].content as string;
    expect(system).not.toMatch(/^\s/);
    expect(system).not.toMatch(/\s$/);
    expect(system.length).toBeGreaterThan(100);
  });

  it("renders the web_edit_section template", async () => {
    const messages = await renderPrompt("web_edit_section", {
      annotation_image_base64: "test_image_data",
      annotations: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.4, text: "Make this bold" },
      ],
      current_html: "<section><p>Hello</p></section>",
    });

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");

    // Check system message mentions HTML editing
    const system = messages[0].content as string;
    expect(system).toContain("HTML");

    // Check user message contains the annotation and HTML
    const userParts = messages[1].content as Array<{
      type: string;
      text?: string;
      image?: string;
    }>;

    const allText = userParts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    expect(allText).toContain("Make this bold");
    expect(allText).toContain("<section><p>Hello</p></section>");

    // Check image is included
    const images = userParts.filter((p) => p.type === "image");
    expect(images.length).toBe(1);
    expect(images[0].image).toBe("test_image_data");
  });
});
