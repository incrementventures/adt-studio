import fs from "node:fs";
import path from "node:path";
import mupdf, { type Document as MupdfDocument } from "mupdf";
import { Observable, throwError } from "rxjs";
import { slugFromPath } from "../slug.js";
import type { Step } from "../step.js";
import type { BookPaths } from "../types.js";
import { resolveBookPaths } from "../types.js";

export interface PageProgress {
  page: number;
  totalPages: number;
  label: string;
}

export interface ExtractResult {
  label: string;
  outputDir: string;
  totalPages: number;
}

export function extract(
  pdfPath: string,
  outputRoot = "books"
): Observable<PageProgress> {
  const label = slugFromPath(pdfPath);
  const bookDir = path.resolve(outputRoot, label, "extract");

  return new Observable<PageProgress>((subscriber) => {
    try {
      // Suppress mupdf native warnings (e.g. "garbage bytes before version marker")
      const origWrite = process.stderr.write;
      process.stderr.write = () => true;
      let doc: MupdfDocument;
      try {
        doc = mupdf.Document.openDocument(
          fs.readFileSync(pdfPath),
          "application/pdf"
        );
      } finally {
        process.stderr.write = origWrite;
      }
      const totalPages = doc.countPages();

      for (let i = 0; i < totalPages; i++) {
        const pageNum = i + 1;
        const pageId = "pg" + String(pageNum).padStart(3, "0");
        const pageDir = path.join(bookDir, "pages", pageId);
        const imagesDir = path.join(pageDir, "images");
        fs.mkdirSync(imagesDir, { recursive: true });

        const page = doc.loadPage(i);

        // Render full-page image at 2x scale (~144 DPI)
        const matrix = mupdf.Matrix.scale(2, 2);
        const pixmap = page.toPixmap(
          matrix,
          mupdf.ColorSpace.DeviceRGB,
          false
        );
        fs.writeFileSync(
          path.join(pageDir, "page.png"),
          Buffer.from(pixmap.asPNG())
        );

        // Extract text
        const stext = page.toStructuredText();
        const text = stext.asText();
        fs.writeFileSync(path.join(pageDir, "text.txt"), text);

        // Extract embedded raster images from page resources
        const pdfDoc = doc.asPDF();
        let imgIndex = 0;
        if (pdfDoc) {
          const pageObj = (page as any).getObject();
          const resources = pageObj.getInheritable("Resources");
          if (!resources.isNull()) {
            const xobjects = resources.get("XObject");
            if (!xobjects.isNull()) {
              xobjects.forEach((xobj: any) => {
                // Resolve to check Subtype, but keep original ref for loadImage
                const resolved = xobj.isIndirect() ? xobj.resolve() : xobj;
                const subtype = resolved.get("Subtype");
                if (!subtype.isNull() && subtype.asName() === "Image") {
                  try {
                    const image = pdfDoc.loadImage(xobj);
                    const imgPixmap = image.toPixmap();
                    imgIndex++;
                    fs.writeFileSync(
                      path.join(
                        imagesDir,
                        pageId + "_im" + String(imgIndex).padStart(3, "0") + ".png"
                      ),
                      Buffer.from(imgPixmap.asPNG())
                    );
                  } catch {
                    // Skip images that fail to decode
                  }
                }
              });
            }
          }
        }

        // Remove empty images directory
        if (imgIndex === 0) {
          fs.rmdirSync(imagesDir);
        }

        subscriber.next({ page: pageNum, totalPages, label });
      }

      subscriber.complete();
    } catch (err) {
      subscriber.error(err);
    }
  });
}

export const extractStep: Step<PageProgress> = {
  name: "extract",
  isComplete(paths: BookPaths): boolean {
    return fs.existsSync(path.join(paths.pagesDir, "pg001", "page.png"));
  },
  run(): Observable<PageProgress> {
    return throwError(
      () => new Error("Extract requires a PDF path. Run: pnpm extract <pdf_path>")
    );
  },
};
