import { describe, it, expect } from "vitest";
import { slugFromPath } from "../slug.js";

describe("slugFromPath", () => {
  it("strips directory and extension", () => {
    expect(slugFromPath("/some/dir/My Book.pdf")).toBe("my-book");
  });

  it("lowercases", () => {
    expect(slugFromPath("FooBar.pdf")).toBe("foobar");
  });

  it("replaces non-alphanumeric with hyphens", () => {
    expect(slugFromPath("hello world (2nd ed).pdf")).toBe("hello-world-2nd-ed");
  });

  it("deduplicates hyphens", () => {
    expect(slugFromPath("a---b.pdf")).toBe("a-b");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugFromPath("--foo--.pdf")).toBe("foo");
  });

  it("handles paths without extension", () => {
    expect(slugFromPath("simple")).toBe("simple");
  });
});
