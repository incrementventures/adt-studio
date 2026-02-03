/**
 * PDF Extraction Step
 *
 * Extracts pages, text, and images from a PDF file.
 *
 * Unlike other steps, this is inherently impure because it:
 * - Reads a PDF file from disk
 * - Writes PNG images to disk
 * - Writes page records to storage
 *
 * The extraction logic is separated from storage details via the
 * ExtractWriter interface.
 */

import mupdf, { type Document as MupdfDocument } from "mupdf";
import { hashBuffer } from "../llm-log";

// ============================================================================
// Types
// ============================================================================

export interface ExtractInput {
  /** PDF file contents as a Buffer */
  pdfBuffer: Buffer;
  /** Page range to extract (1-indexed, inclusive) */
  startPage?: number;
  endPage?: number;
}

export interface ExtractedPage {
  pageId: string;
  pageNumber: number;
  text: string;
  pageImage: ExtractedImage;
  images: ExtractedImage[];
}

export interface ExtractedImage {
  imageId: string;
  pageId: string;
  pngBuffer: Buffer;
  width: number;
  height: number;
  hash: string;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  format?: string;
  encryption?: string;
}

export interface ExtractResult {
  pages: ExtractedPage[];
  pdfMetadata: PdfMetadata;
  totalPagesInPdf: number;
}

export interface ExtractProgress {
  page: number;
  totalPages: number;
}

// ============================================================================
// Pure extraction function
// ============================================================================

/**
 * Extract pages and images from a PDF.
 *
 * This function is "mostly pure" - it takes a PDF buffer and returns
 * extracted data. The caller is responsible for writing the data to
 * storage.
 *
 * @param input - PDF buffer and page range options
 * @param onProgress - Optional progress callback
 * @returns Extracted pages with images and PDF metadata
 */
export async function extractPdf(
  input: ExtractInput,
  onProgress?: (progress: ExtractProgress) => void
): Promise<ExtractResult> {
  const { pdfBuffer, startPage = 1, endPage } = input;

  // Open PDF (suppressing mupdf stderr spam)
  const doc = openPdfFromBuffer(pdfBuffer);

  // Extract PDF metadata
  const pdfMetadata = extractPdfMetadata(doc);

  // Determine page range
  const totalPagesInPdf = doc.countPages();
  const start = startPage - 1; // Convert to 0-indexed
  const end = Math.min(endPage ?? totalPagesInPdf, totalPagesInPdf);
  const rangeSize = end - start;

  const pages: ExtractedPage[] = [];

  for (let i = start; i < end; i++) {
    const page = extractPage(doc, i);
    pages.push(page);

    onProgress?.({
      page: i - start + 1,
      totalPages: rangeSize,
    });

    // Yield to event loop periodically
    await tick();
  }

  return {
    pages,
    pdfMetadata,
    totalPagesInPdf,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

const tick = () => new Promise<void>((r) => setImmediate(r));

function openPdfFromBuffer(buffer: Buffer): MupdfDocument {
  // Suppress mupdf stderr warnings
  const origWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return mupdf.Document.openDocument(buffer, "application/pdf");
  } finally {
    process.stderr.write = origWrite;
  }
}

const METADATA_KEYS: [keyof PdfMetadata, string][] = [
  ["title", "info:Title"],
  ["author", "info:Author"],
  ["subject", "info:Subject"],
  ["keywords", "info:Keywords"],
  ["creator", "info:Creator"],
  ["producer", "info:Producer"],
  ["creationDate", "info:CreationDate"],
  ["modificationDate", "info:ModDate"],
  ["format", "format"],
  ["encryption", "encryption"],
];

function extractPdfMetadata(doc: MupdfDocument): PdfMetadata {
  const metadata: PdfMetadata = {};
  for (const [key, mupdfKey] of METADATA_KEYS) {
    const value = doc.getMetaData(mupdfKey);
    if (value) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function extractPage(doc: MupdfDocument, pageIndex: number): ExtractedPage {
  const pageNum = pageIndex + 1;
  const pageId = "pg" + String(pageNum).padStart(3, "0");

  const page = doc.loadPage(pageIndex);

  // Render full-page image at 2x scale (~144 DPI)
  const matrix = mupdf.Matrix.scale(2, 2);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  const pagePngBuf = Buffer.from(pixmap.asPNG());

  const pageImage: ExtractedImage = {
    imageId: `${pageId}_page`,
    pageId,
    pngBuffer: pagePngBuf,
    width: pagePngBuf.readUInt32BE(16),
    height: pagePngBuf.readUInt32BE(20),
    hash: hashBuffer(pagePngBuf),
  };

  // Extract text
  const stext = page.toStructuredText();
  const text = stext.asText();

  // Extract embedded raster images
  const embeddedImages = extractEmbeddedImages(doc, page, pageId);

  return {
    pageId,
    pageNumber: pageNum,
    text,
    pageImage,
    images: embeddedImages,
  };
}

function extractEmbeddedImages(
  doc: MupdfDocument,
  page: ReturnType<MupdfDocument["loadPage"]>,
  pageId: string
): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const pdfDoc = doc.asPDF();
  if (!pdfDoc) return images;

  let imgIndex = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageObj = (page as any).getObject();
  const resources = pageObj.getInheritable("Resources");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractImagesFromResources(res: any): void {
    if (res.isNull()) return;
    const xobjects = res.get("XObject");
    if (xobjects.isNull()) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    xobjects.forEach((xobj: any) => {
      const resolved = xobj.isIndirect() ? xobj.resolve() : xobj;
      const subtype = resolved.get("Subtype");
      if (subtype.isNull()) return;

      const name = subtype.asName();
      if (name === "Image") {
        try {
          const image = pdfDoc!.loadImage(xobj);
          const imgPixmap = image.toPixmap();
          imgIndex++;
          const imgId = pageId + "_im" + String(imgIndex).padStart(3, "0");
          const imgBuf = Buffer.from(imgPixmap.asPNG());

          images.push({
            imageId: imgId,
            pageId,
            pngBuffer: imgBuf,
            width: imgBuf.readUInt32BE(16),
            height: imgBuf.readUInt32BE(20),
            hash: hashBuffer(imgBuf),
          });
        } catch {
          // Skip images that fail to decode
        }
      } else if (name === "Form") {
        // Recurse into Form XObjects
        const formResources = resolved.get("Resources");
        if (!formResources.isNull()) {
          extractImagesFromResources(formResources);
        }
      }
    });
  }

  extractImagesFromResources(resources);
  return images;
}
