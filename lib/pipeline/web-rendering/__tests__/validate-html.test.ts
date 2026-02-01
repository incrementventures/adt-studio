import { describe, it, expect } from "vitest";
import { validateSectionHtml } from "../validate-html";

describe("validateSectionHtml", () => {
  const textIds = ["pg001_gp001_t001", "pg001_gp001_t002"];
  const imageIds = ["pg001_img001"];

  it("passes for valid HTML with correct data-ids", () => {
    const html = `
      <div data-id="pg001_gp001_t001">Hello world</div>
      <div data-id="pg001_gp001_t002">Second text</div>
      <img data-id="pg001_img001" src="img.png" />
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when a text node is outside any data-id element", () => {
    const html = `
      <div>
        <span>Hallucinated text</span>
        <div data-id="pg001_gp001_t001">Real text</div>
      </div>
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("outside any data-id element");
  });

  it("fails when an unknown data-id is used", () => {
    const html = `
      <div data-id="pg001_gp001_t001">Real text</div>
      <div data-id="pg999_fake_id">Fake text</div>
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Unknown data-id")
    );
  });

  it("passes for whitespace-only text nodes", () => {
    const html = `
      <div>
        <div data-id="pg001_gp001_t001">Hello</div>
      </div>
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(true);
  });

  it("exempts text inside <style> tags", () => {
    const html = `
      <style>.foo { color: red; }</style>
      <div data-id="pg001_gp001_t001">Hello</div>
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(true);
  });

  it("exempts text inside <script> tags", () => {
    const html = `
      <script>var x = 1;</script>
      <div data-id="pg001_gp001_t001">Hello</div>
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(true);
  });

  it("passes when ancestor has data-id (nested elements)", () => {
    const html = `
      <div data-id="pg001_gp001_t001">
        <span><em>Nested text</em></span>
      </div>
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(true);
  });

  it("reports multiple errors", () => {
    const html = `
      <div data-id="pg999_bad">Bad id</div>
      <p>Orphan text</p>
    `;
    const result = validateSectionHtml(html, textIds, imageIds);
    expect(result.valid).toBe(false);
    // unknown data-id + orphan text in <p> (text inside data-id element is not an orphan)
    expect(result.errors.length).toBe(2);
  });

  it("passes for empty HTML", () => {
    const result = validateSectionHtml("", textIds, imageIds);
    expect(result.valid).toBe(true);
  });
});
