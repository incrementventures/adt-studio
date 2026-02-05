import { describe, it, expect } from "vitest";
import { extractPdf } from "../extract";

// Minimal valid PDF with one blank page (no content stream)
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
178
%%EOF`;

// Two-page PDF
const TWO_PAGE_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
4 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000102 00000 n
0000000169 00000 n
trailer<</Size 5/Root 1 0 R>>
startxref
236
%%EOF`;

describe("extractPdf", () => {
  it("extracts a single page from a minimal PDF", async () => {
    const pdfBuffer = Buffer.from(MINIMAL_PDF);
    const result = await extractPdf({ pdfBuffer });

    expect(result.totalPagesInPdf).toBe(1);
    expect(result.pages).toHaveLength(1);

    const page = result.pages[0];
    expect(page.pageNumber).toBe(1);
    expect(page.pageId).toBe("pg001");
    expect(page.text).toBe("");
    expect(page.pageImage).toBeDefined();
    expect(page.pageImage.pngBuffer).toBeInstanceOf(Buffer);
    expect(page.pageImage.width).toBeGreaterThan(0);
    expect(page.pageImage.height).toBeGreaterThan(0);
    expect(page.pageImage.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(page.images).toEqual([]);
  });

  it("extracts multiple pages", async () => {
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF);
    const result = await extractPdf({ pdfBuffer });

    expect(result.totalPagesInPdf).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].pageId).toBe("pg001");
    expect(result.pages[1].pageId).toBe("pg002");
  });

  it("respects startPage option", async () => {
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF);
    const result = await extractPdf({ pdfBuffer, startPage: 2 });

    expect(result.totalPagesInPdf).toBe(2);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(2);
    expect(result.pages[0].pageId).toBe("pg002");
  });

  it("respects endPage option", async () => {
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF);
    const result = await extractPdf({ pdfBuffer, endPage: 1 });

    expect(result.totalPagesInPdf).toBe(2);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(1);
  });

  it("respects both startPage and endPage options", async () => {
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF);
    const result = await extractPdf({ pdfBuffer, startPage: 1, endPage: 1 });

    expect(result.totalPagesInPdf).toBe(2);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(1);
  });

  it("calls progress callback for each page", async () => {
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF);
    const progressCalls: { page: number; totalPages: number }[] = [];

    await extractPdf({ pdfBuffer }, (progress) => {
      progressCalls.push({ ...progress });
    });

    expect(progressCalls).toEqual([
      { page: 1, totalPages: 2 },
      { page: 2, totalPages: 2 },
    ]);
  });

  it("clamps endPage to actual page count", async () => {
    const pdfBuffer = Buffer.from(MINIMAL_PDF);
    const result = await extractPdf({ pdfBuffer, endPage: 100 });

    expect(result.totalPagesInPdf).toBe(1);
    expect(result.pages).toHaveLength(1);
  });

  it("returns empty pages array when startPage exceeds page count", async () => {
    const pdfBuffer = Buffer.from(MINIMAL_PDF);
    const result = await extractPdf({ pdfBuffer, startPage: 10 });

    expect(result.totalPagesInPdf).toBe(1);
    expect(result.pages).toHaveLength(0);
  });

  it("returns PDF metadata", async () => {
    const pdfBuffer = Buffer.from(MINIMAL_PDF);
    const result = await extractPdf({ pdfBuffer });

    expect(result.pdfMetadata).toBeDefined();
    expect(typeof result.pdfMetadata).toBe("object");
  });

  it("throws on invalid PDF data", async () => {
    const pdfBuffer = Buffer.from("not a pdf");

    await expect(extractPdf({ pdfBuffer })).rejects.toThrow();
  });
});
