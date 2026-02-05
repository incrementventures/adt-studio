/**
 * PDF Extraction Library
 *
 * Extracts pages, text, and images from PDF files using mupdf.
 */

import { createHash } from "crypto";
import mupdf, { type Document as MupdfDocument } from "mupdf";
import sharp from "sharp";

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
// Main extraction function
// ============================================================================

/**
 * Extract pages and images from a PDF.
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
    const page = await extractPage(doc, i);
    pages.push(page);

    onProgress?.({
      page: i - start + 1,
      totalPages: rangeSize,
    });
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

function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf.toString("base64")).digest("hex").slice(0, 16);
}

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

async function extractPage(doc: MupdfDocument, pageIndex: number): Promise<ExtractedPage> {
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

  // Extract embedded raster images and vector graphics
  const embeddedImages = extractEmbeddedImages(doc, page, pageId);
  const vectorImages = await extractVectorImages(page, pageId, embeddedImages.length);

  return {
    pageId,
    pageNumber: pageNum,
    text,
    pageImage,
    images: [...embeddedImages, ...vectorImages],
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

/**
 * Minimum dimension (in points) for a vector image to be extracted.
 * Filters out tiny decorative elements like bullets or icons.
 */
const MIN_VECTOR_DIMENSION = 25;

/**
 * Percentage of page dimension above which items are considered backgrounds.
 */
const OVERLAP_THRESHOLD_PERCENT = 0.75;

/**
 * Margin (in points) for overlap detection when grouping shapes.
 */
const OVERLAP_MARGIN = 5;

type BBox = [number, number, number, number]; // [minX, minY, maxX, maxY]

interface ShapeInfo {
  /** Transformed bbox - where the shape actually appears on page */
  bbox: BBox;
  /** Original bbox from path data - for viewBox when rendering */
  originalBbox: BBox;
  seqno: number;
  /** The full SVG element string (e.g., <path d="..." fill="..."/>) */
  svgElement: string;
}

/**
 * Parse SVG path data to extract bounding box.
 * Handles M (moveto), L (lineto), H (horizontal), V (vertical), Z (close),
 * and basic curve commands.
 */
function parseSvgPathBbox(d: string): BBox | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let currentX = 0,
    currentY = 0;

  // Match commands and their parameters
  const commands = d.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi);
  if (!commands) return null;

  for (const cmd of commands) {
    const type = cmd[0];
    // Parse numbers properly - they can run together when separated by negative signs
    // e.g., ".073-.195" is two numbers: 0.073 and -0.195
    const argStr = cmd.slice(1).trim();
    const args = (argStr.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || []).map(parseFloat);

    switch (type.toUpperCase()) {
      case "M": // moveto
      case "L": // lineto
        for (let i = 0; i < args.length; i += 2) {
          const x = type === type.toUpperCase() ? args[i] : currentX + args[i];
          const y =
            type === type.toUpperCase() ? args[i + 1] : currentY + args[i + 1];
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          currentX = x;
          currentY = y;
        }
        break;
      case "H": // horizontal lineto
        for (const arg of args) {
          const x = type === "H" ? arg : currentX + arg;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          currentX = x;
        }
        break;
      case "V": // vertical lineto
        for (const arg of args) {
          const y = type === "V" ? arg : currentY + arg;
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          currentY = y;
        }
        break;
      case "C": // cubic bezier
        for (let i = 0; i < args.length; i += 6) {
          // Include all control points and endpoint in bounds
          for (let j = 0; j < 6; j += 2) {
            const x =
              type === "C" ? args[i + j] : currentX + args[i + j];
            const y =
              type === "C" ? args[i + j + 1] : currentY + args[i + j + 1];
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
          currentX = type === "C" ? args[i + 4] : currentX + args[i + 4];
          currentY = type === "C" ? args[i + 5] : currentY + args[i + 5];
        }
        break;
      case "S": // smooth cubic bezier
      case "Q": // quadratic bezier
        for (let i = 0; i < args.length; i += 4) {
          for (let j = 0; j < 4; j += 2) {
            const x =
              type === type.toUpperCase() ? args[i + j] : currentX + args[i + j];
            const y =
              type === type.toUpperCase()
                ? args[i + j + 1]
                : currentY + args[i + j + 1];
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
          currentX =
            type === type.toUpperCase() ? args[i + 2] : currentX + args[i + 2];
          currentY =
            type === type.toUpperCase() ? args[i + 3] : currentY + args[i + 3];
        }
        break;
      case "T": // smooth quadratic bezier
        for (let i = 0; i < args.length; i += 2) {
          const x =
            type === "T" ? args[i] : currentX + args[i];
          const y =
            type === "T" ? args[i + 1] : currentY + args[i + 1];
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          currentX = x;
          currentY = y;
        }
        break;
      case "A": // arc
        // For arcs, just include the endpoint (simplified)
        for (let i = 0; i < args.length; i += 7) {
          const x =
            type === "A" ? args[i + 5] : currentX + args[i + 5];
          const y =
            type === "A" ? args[i + 6] : currentY + args[i + 6];
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          currentX = x;
          currentY = y;
        }
        break;
      case "Z": // closepath
        break;
    }
  }

  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

/**
 * Parse SVG transform="matrix(a,b,c,d,e,f)" and apply to a bounding box.
 * Returns the transformed bbox.
 */
function applyMatrixTransformToBbox(
  bbox: BBox,
  transformAttr: string | null
): BBox {
  if (!transformAttr) return bbox;

  // Parse matrix(a,b,c,d,e,f)
  const matrixMatch = /matrix\(([^)]+)\)/.exec(transformAttr);
  if (!matrixMatch) return bbox;

  const values = matrixMatch[1].split(/[\s,]+/).map(parseFloat);
  if (values.length !== 6) return bbox;

  const [a, b, c, d, e, f] = values;
  const [minX, minY, maxX, maxY] = bbox;

  // Transform all 4 corners
  const corners = [
    [minX, minY],
    [maxX, minY],
    [minX, maxY],
    [maxX, maxY],
  ];

  const transformed = corners.map(([x, y]) => [
    a * x + c * y + e,
    b * x + d * y + f,
  ]);

  // Find new bounds
  const xs = transformed.map((p) => p[0]);
  const ys = transformed.map((p) => p[1]);

  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
}

/**
 * Extract shapes from SVG content.
 * Returns array of shapes with their bounding boxes (after applying transforms).
 * Only extracts visible content - skips <defs> section (font glyphs, clipPaths, etc).
 */
function extractShapesFromSvg(svgContent: string): ShapeInfo[] {
  const shapes: ShapeInfo[] = [];
  let seqno = 0;

  // Remove <defs>...</defs> section - contains font glyphs, clipPaths, masks
  // These are definitions, not visible content
  const contentWithoutDefs = svgContent.replace(/<defs>[\s\S]*?<\/defs>/gi, "");

  // Extract path elements with full element string
  const pathRegex = /<path[^>]*>/gi;
  let match;
  while ((match = pathRegex.exec(contentWithoutDefs)) !== null) {
    const fullElement = match[0];
    const dMatch = /\sd="([^"]+)"/.exec(fullElement);
    if (!dMatch) continue;

    const d = dMatch[1];
    const originalBbox = parseSvgPathBbox(d);
    if (!originalBbox || originalBbox[2] <= originalBbox[0] || originalBbox[3] <= originalBbox[1]) continue;

    // Apply transform to get actual rendered position
    const transformMatch = /\stransform="([^"]+)"/.exec(fullElement);
    const bbox = applyMatrixTransformToBbox(originalBbox, transformMatch?.[1] ?? null);

    if (bbox[2] > bbox[0] && bbox[3] > bbox[1]) {
      shapes.push({ bbox, originalBbox, seqno: seqno++, svgElement: fullElement });
    }
  }

  // Extract rect elements with full element string
  const rectRegex = /<rect[^>]*>/gi;
  while ((match = rectRegex.exec(contentWithoutDefs)) !== null) {
    const fullElement = match[0];
    const xMatch = /\sx="([^"]+)"/.exec(fullElement);
    const yMatch = /\sy="([^"]+)"/.exec(fullElement);
    const wMatch = /\swidth="([^"]+)"/.exec(fullElement);
    const hMatch = /\sheight="([^"]+)"/.exec(fullElement);

    if (xMatch && yMatch && wMatch && hMatch) {
      const x = parseFloat(xMatch[1]);
      const y = parseFloat(yMatch[1]);
      const w = parseFloat(wMatch[1]);
      const h = parseFloat(hMatch[1]);

      if (w > 0 && h > 0) {
        const originalBbox: BBox = [x, y, x + w, y + h];

        // Apply transform to get actual rendered position
        const transformMatch = /\stransform="([^"]+)"/.exec(fullElement);
        const bbox = applyMatrixTransformToBbox(originalBbox, transformMatch?.[1] ?? null);

        // Check for duplicates
        const exists = shapes.some(
          (s) =>
            Math.abs(s.bbox[0] - bbox[0]) < 0.1 &&
            Math.abs(s.bbox[1] - bbox[1]) < 0.1 &&
            Math.abs(s.bbox[2] - bbox[2]) < 0.1 &&
            Math.abs(s.bbox[3] - bbox[3]) < 0.1
        );
        if (!exists) {
          shapes.push({ bbox, originalBbox, seqno: seqno++, svgElement: fullElement });
        }
      }
    }
  }

  return shapes;
}

/**
 * Check if two bounding boxes overlap.
 */
function boxesOverlap(box1: BBox, box2: BBox, margin: number = 0): boolean {
  const [minX1, minY1, maxX1, maxY1] = box1;
  const [minX2, minY2, maxX2, maxY2] = box2;

  return !(
    maxX1 + margin < minX2 ||
    maxX2 + margin < minX1 ||
    maxY1 + margin < minY2 ||
    maxY2 + margin < minY1
  );
}

/**
 * Group overlapping shapes using union-find algorithm.
 */
function groupOverlappingShapes(
  shapes: ShapeInfo[],
  margin: number
): ShapeInfo[][] {
  const n = shapes.length;
  if (n === 0) return [];

  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (x: number, y: number): void => {
    const xRoot = find(x);
    const yRoot = find(y);
    if (xRoot !== yRoot) {
      parent[yRoot] = xRoot;
    }
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (boxesOverlap(shapes[i].bbox, shapes[j].bbox, margin)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, ShapeInfo[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(shapes[i]);
  }

  return Array.from(groups.values()).map((group) =>
    group.sort((a, b) => a.seqno - b.seqno)
  );
}

/**
 * Compute the combined bounding box of a group of shapes.
 */
function computeGroupBbox(group: ShapeInfo[]): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const shape of group) {
    const [x0, y0, x1, y1] = shape.bbox;
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }

  return [minX, minY, maxX, maxY];
}

/**
 * Convert a PDF page to SVG using mupdf DocumentWriter.
 * Returns both the full SVG content and extracted shapes.
 */
function getPageSvgAndShapes(
  page: ReturnType<MupdfDocument["loadPage"]>
): { svgContent: string; shapes: ShapeInfo[] } {
  try {
    // Use DocumentWriter to render page as SVG
    const buf = new mupdf.Buffer();
    const writer = new mupdf.DocumentWriter(buf, "svg", "");

    const mediabox = page.getBounds();
    const device = writer.beginPage(mediabox);
    page.run(device, mupdf.Matrix.identity);
    writer.endPage();
    writer.close();

    const svgContent = buf.asString();
    return { svgContent, shapes: extractShapesFromSvg(svgContent) };
  } catch {
    return { svgContent: "", shapes: [] };
  }
}

async function extractVectorImages(
  page: ReturnType<MupdfDocument["loadPage"]>,
  pageId: string,
  startIndex: number
): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = [];
  let imgIndex = startIndex;

  // Get full SVG and shapes from conversion
  const { shapes: allShapes } = getPageSvgAndShapes(page);
  if (allShapes.length === 0) return images;

  // Render each shape as its own transparent SVG
  for (const shape of allShapes) {
    const [minX, minY, maxX, maxY] = shape.bbox;
    const width = maxX - minX;
    const height = maxY - minY;

    // Skip shapes with invalid dimensions
    if (width <= 0 || height <= 0) continue;

    // Create standalone SVG for this shape with transparent background
    // Use translate to shift shape to origin (0,0)
    // Note: We don't include defs since vector shapes have inline fill/stroke
    const shapeSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}">
<g transform="translate(${-minX}, ${-minY})">
${shape.svgElement}
</g>
</svg>`;

    try {
      // Render to PNG with transparency (144 DPI = 2x scale)
      const pngBuf = await sharp(Buffer.from(shapeSvg), { density: 144 })
        .png()
        .toBuffer();

      imgIndex++;
      const imgId = pageId + "_im" + String(imgIndex).padStart(3, "0");

      images.push({
        imageId: imgId,
        pageId,
        pngBuffer: pngBuf,
        width: pngBuf.readUInt32BE(16),
        height: pngBuf.readUInt32BE(20),
        hash: hashBuffer(pngBuf),
      });
    } catch {
      // Skip shapes that fail to render (e.g., bad dimensions)
    }
  }

  return images;
}
