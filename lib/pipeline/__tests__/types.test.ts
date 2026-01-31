import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveBookPaths } from "../types.js";

describe("resolveBookPaths", () => {
  it("returns correct structure for a label", () => {
    const paths = resolveBookPaths("raven", "books");
    const bookDir = path.resolve("books", "raven");

    expect(paths.bookDir).toBe(bookDir);
    expect(paths.extractDir).toBe(path.join(bookDir, "extract"));
    expect(paths.pagesDir).toBe(path.join(bookDir, "extract", "pages"));
    expect(paths.metadataDir).toBe(path.join(bookDir, "metadata"));
    expect(paths.metadataFile).toBe(
      path.join(bookDir, "metadata", "metadata.json")
    );
    expect(paths.textExtractionDir).toBe(
      path.join(bookDir, "text-extraction")
    );
  });

  it("defaults outputRoot to 'books'", () => {
    const paths = resolveBookPaths("test");
    expect(paths.bookDir).toBe(path.resolve("books", "test"));
  });
});
