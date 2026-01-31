import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { PageSectioning } from "./page-sectioning-schema";
import { loadConfig } from "../../config";
import {
  defineNode,
  createContext,
  resolveNode,
  resolveModel,
  type LLMProvider,
  type Node,
} from "../node";
import { pagesNode } from "../extract/extract";
import { textExtractionNode } from "../text-extraction/text-extraction";
import { buildUnprunedGroupSummaries, type PageTextExtraction } from "../text-extraction/text-extraction-schema";
import { sectionPage } from "./section-page";

export { sectionPage } from "./section-page";

const DEFAULT_CONCURRENCY = 5;

export interface PageSectioningProgress {
  phase: "loading" | "sectioning";
  page?: number;
  totalPages?: number;
  label: string;
}

export const sectionsNode: Node<PageSectioning[]> = defineNode<
  PageSectioning[] | PageSectioningProgress
>({
  name: "page-sectioning",
  isComplete: (ctx) => {
    const dir = path.resolve(ctx.outputRoot, ctx.label, "page-sectioning");
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^pg\d{3}\.json$/.test(f));
    if (files.length === 0) return null;
    const pagesDir = path.resolve(
      ctx.outputRoot,
      ctx.label,
      "extract",
      "pages"
    );
    if (fs.existsSync(pagesDir)) {
      const pageCount = fs
        .readdirSync(pagesDir)
        .filter((d) => /^pg\d{3}$/.test(d)).length;
      if (files.length < pageCount) return null;
    }
    return files
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
  },
  resolve: (ctx) => {
    return new Observable<PageSectioning[] | PageSectioningProgress>(
      (subscriber) => {
        (async () => {
          try {
            subscriber.next({ phase: "loading", label: ctx.label });

            const [allPages, allExtractions] = await Promise.all([
              resolveNode(pagesNode, ctx),
              resolveNode(textExtractionNode, ctx),
            ]);

            const sectionTypes = ctx.config.section_types ?? {};
            if (Object.keys(sectionTypes).length === 0) {
              throw new Error(
                "No section_types defined in config — cannot run page sectioning"
              );
            }

            const sectioningDir = path.resolve(
              ctx.outputRoot,
              ctx.label,
              "page-sectioning"
            );
            fs.mkdirSync(sectioningDir, { recursive: true });

            const totalPages = allPages.length;
            const results: (PageSectioning | undefined)[] = new Array(
              totalPages
            );
            let completed = 0;

            const promptName =
              ctx.config.page_sectioning?.prompt ?? "page_sectioning";
            const sectionTypeList = Object.entries(sectionTypes).map(
              ([key, description]) => ({ key, description })
            );

            const concurrency =
              ctx.config.page_sectioning?.concurrency ?? DEFAULT_CONCURRENCY;

            async function processPage(i: number): Promise<void> {
              const p = allPages[i];
              const extraction: PageTextExtraction = allExtractions[i];

              // Read page image as base64
              const pageImageBase64 = fs
                .readFileSync(p.imagePath)
                .toString("base64");

              // Discover extracted images from extract/pages/pgXXX/images/
              const imagesDir = path.join(
                path.dirname(p.imagePath),
                "images"
              );
              const images: { image_id: string; imageBase64: string }[] = [];
              if (fs.existsSync(imagesDir)) {
                const imageFiles = fs
                  .readdirSync(imagesDir)
                  .filter((f) => /\.png$/i.test(f))
                  .sort();
                for (const imgFile of imageFiles) {
                  const imageId = imgFile.replace(/\.png$/i, "");
                  const imgBase64 = fs
                    .readFileSync(path.join(imagesDir, imgFile))
                    .toString("base64");
                  images.push({ image_id: imageId, imageBase64: imgBase64 });
                }
              }

              // Build group summaries, excluding pruned text entries
              const groups = buildUnprunedGroupSummaries(extraction, p.pageId);

              const sectioning = await sectionPage({
                model: resolveModel(ctx, ctx.config.page_sectioning?.model),
                pageImageBase64,
                images,
                groups,
                sectionTypes: sectionTypeList,
                promptName,
                cacheDir: sectioningDir,
              });

              fs.writeFileSync(
                path.join(sectioningDir, `${p.pageId}.json`),
                JSON.stringify(sectioning, null, 2) + "\n"
              );

              results[i] = sectioning;
              completed++;

              subscriber.next({
                phase: "sectioning",
                page: completed,
                totalPages,
                label: ctx.label,
              });
            }

            // Process pages with bounded concurrency
            const queue = allPages.map((_, i) => i);
            const workers = Array.from(
              { length: Math.min(concurrency, totalPages) },
              async () => {
                while (queue.length > 0) {
                  const i = queue.shift()!;
                  await processPage(i);
                }
              }
            );
            await Promise.all(workers);

            subscriber.next(results as PageSectioning[]);
            subscriber.complete();
          } catch (err) {
            subscriber.error(err);
          }
        })();
      }
    );
  },
}) as Node<PageSectioning[]>;

export function sectionPages(
  label: string,
  options?: { provider?: LLMProvider; outputRoot?: string }
): Observable<PageSectioningProgress> {
  const config = loadConfig();
  const ctx = createContext(label, {
    config,
    outputRoot: options?.outputRoot,
    provider: options?.provider ?? (config.provider as LLMProvider | undefined),
  });

  return new Observable<PageSectioningProgress>((subscriber) => {
    sectionsNode.resolve(ctx).subscribe({
      next(v) {
        if (v && typeof v === "object" && "phase" in v && "label" in v) {
          subscriber.next(v as unknown as PageSectioningProgress);
        }
      },
      error: (err) => subscriber.error(err),
      complete: () => subscriber.complete(),
    });
  });
}
