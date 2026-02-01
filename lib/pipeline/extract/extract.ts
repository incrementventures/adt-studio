import fs from "node:fs";
import path from "node:path";
import mupdf, { type Document as MupdfDocument } from "mupdf";
import { Observable } from "rxjs";
import { slugFromPath } from "../slug";
import { defineNode, type PipelineContext, type Node } from "../node";

export interface Page {
  pageId: string;
  pageNumber: number;
  text: string;
  imagePath: string;
}

export interface PageProgress {
  page: number;
  totalPages: number;
  label: string;
}

function readPagesFromDisk(pagesDir: string): Page[] {
  return fs
    .readdirSync(pagesDir)
    .filter((d) => /^pg\d{3}$/.test(d))
    .sort()
    .map((pageId) => {
      const pageDir = path.join(pagesDir, pageId);
      const text = fs.readFileSync(path.join(pageDir, "text.txt"), "utf-8");
      return {
        pageId,
        pageNumber: parseInt(pageId.slice(2), 10),
        text,
        imagePath: path.join(pageDir, "page.png"),
      };
    });
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

function writePdfMetadata(doc: MupdfDocument, extractDir: string): void {
  const metadata = extractPdfMetadata(doc);
  fs.mkdirSync(extractDir, { recursive: true });
  fs.writeFileSync(
    path.join(extractDir, "metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
}

const tick = () => new Promise<void>((r) => setImmediate(r));

function openPdf(pdfPath: string): MupdfDocument {
  const origWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return mupdf.Document.openDocument(
      fs.readFileSync(pdfPath),
      "application/pdf"
    );
  } finally {
    process.stderr.write = origWrite;
  }
}

function extractPage(doc: MupdfDocument, i: number, bookDir: string): Page {
  const pageNum = i + 1;
  const pageId = "pg" + String(pageNum).padStart(3, "0");
  const pageDir = path.join(bookDir, "pages", pageId);
  const imagesDir = path.join(pageDir, "images");
  fs.mkdirSync(imagesDir, { recursive: true });

  const page = doc.loadPage(i);

  // Render full-page image at 2x scale (~144 DPI)
  const matrix = mupdf.Matrix.scale(2, 2);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  const imagePath = path.join(pageDir, "page.png");
  fs.writeFileSync(imagePath, Buffer.from(pixmap.asPNG()));

  // Extract text
  const stext = page.toStructuredText();
  const text = stext.asText();
  fs.writeFileSync(path.join(pageDir, "text.txt"), text);

  // Extract embedded raster images from page resources (including Form XObjects)
  const pdfDoc = doc.asPDF();
  let imgIndex = 0;
  if (pdfDoc) {
    const pageObj = (page as any).getObject();
    const resources = pageObj.getInheritable("Resources");

    function extractImagesFromResources(res: any): void {
      if (res.isNull()) return;
      const xobjects = res.get("XObject");
      if (xobjects.isNull()) return;
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
            fs.writeFileSync(
              path.join(
                imagesDir,
                pageId +
                  "_im" +
                  String(imgIndex).padStart(3, "0") +
                  ".png"
              ),
              Buffer.from(imgPixmap.asPNG())
            );
          } catch {
            // Skip images that fail to decode
          }
        } else if (name === "Form") {
          const formResources = resolved.get("Resources");
          if (!formResources.isNull()) {
            extractImagesFromResources(formResources);
          }
        }
      });
    }

    extractImagesFromResources(resources);
  }

  // Remove empty images directory
  if (imgIndex === 0) {
    fs.rmdirSync(imagesDir);
  }

  return { pageId, pageNumber: pageNum, text, imagePath };
}

async function extractPages(options: {
  pdfPath: string;
  extractDir: string;
  label: string;
  startPage?: number;
  endPage?: number;
  onProgress: (progress: PageProgress) => void;
}): Promise<Page[]> {
  const doc = openPdf(options.pdfPath);
  writePdfMetadata(doc, options.extractDir);
  const totalPages = doc.countPages();
  const start = (options.startPage ?? 1) - 1;
  const end = Math.min(options.endPage ?? totalPages, totalPages);
  const rangeSize = end - start;
  const pages: Page[] = [];

  for (let i = start; i < end; i++) {
    const page = extractPage(doc, i, options.extractDir);
    pages.push(page);
    options.onProgress({ page: i - start + 1, totalPages: rangeSize, label: options.label });
    await tick();
  }

  return pages;
}

export const pagesNode: Node<Page[]> = defineNode<Page[] | PageProgress>({
  name: "pages",
  isComplete: (ctx) => {
    const pagesDir = path.resolve(ctx.outputRoot, ctx.label, "extract", "pages");
    const startPage = ctx.config.start_page ?? 1;
    const firstPageId = "pg" + String(startPage).padStart(3, "0");
    if (!fs.existsSync(path.join(pagesDir, firstPageId, "page.png"))) return null;
    const allPages = readPagesFromDisk(pagesDir);
    const endPage = ctx.config.end_page ?? Infinity;
    return allPages.filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage);
  },
  resolve: (ctx) => {
    const pdfPath = ctx.config.pdf_path;
    if (!pdfPath) {
      throw new Error("pdf_path required in config (or pass via CLI)");
    }

    return new Observable<Page[] | PageProgress>((subscriber) => {
      (async () => {
        try {
          const pages = await extractPages({
            pdfPath,
            extractDir: path.resolve(ctx.outputRoot, ctx.label, "extract"),
            label: ctx.label,
            startPage: ctx.config.start_page,
            endPage: ctx.config.end_page,
            onProgress: (p) => subscriber.next(p),
          });
          subscriber.next(pages);
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  },
}) as Node<Page[]>;

// Convenience wrapper for CLI usage
export function extract(
  pdfPath: string,
  outputRoot = "books",
  options?: { startPage?: number; endPage?: number }
): Observable<PageProgress> {
  const label = slugFromPath(pdfPath);

  return new Observable<PageProgress>((subscriber) => {
    (async () => {
      try {
        await extractPages({
          pdfPath,
          extractDir: path.resolve(outputRoot, label, "extract"),
          label,
          startPage: options?.startPage,
          endPage: options?.endPage,
          onProgress: (p) => subscriber.next(p),
        });
        subscriber.complete();
      } catch (err) {
        subscriber.error(err);
      }
    })();
  });
}
