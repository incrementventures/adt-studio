import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { WebRendering } from "./web-rendering-schema";
import { loadBookConfig } from "../../config";
import {
  defineNode,
  createContext,
  resolveNode,
  resolveModel,
  type LLMProvider,
  type Node,
} from "../node";
import { pagesNode } from "../extract/extract";
import { imageClassificationNode } from "../image-classification/image-classification";
import { sectionsNode } from "../page-sectioning/page-sectioning";
import { loadUnprunedImagesFromDir, countPages } from "../../books";
import { renderSection } from "./render-section";
import { collectSectionInputs } from "./collect-section-inputs";

export { renderSection } from "./render-section";

const DEFAULT_CONCURRENCY = 5;

export interface WebRenderingProgress {
  phase: "loading" | "rendering";
  page?: number;
  totalPages?: number;
  label: string;
}

export const webRenderingNode: Node<WebRendering[]> = defineNode<
  WebRendering[] | WebRenderingProgress
>({
  name: "web-rendering",
  isComplete: (ctx) => {
    const dir = path.resolve(ctx.outputRoot, ctx.label, "web-rendering");
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^pg\d{3}\.json$/.test(f));
    if (files.length === 0) return null;
    const pageCount = countPages(ctx.label);
    if (pageCount > 0 && files.length < pageCount) return null;
    return files
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
  },
  resolve: (ctx) => {
    return new Observable<WebRendering[] | WebRenderingProgress>(
      (subscriber) => {
        (async () => {
          try {
            subscriber.next({ phase: "loading", label: ctx.label });

            const [allPages, allImageClassifications, allSectionings] =
              await Promise.all([
                resolveNode(pagesNode, ctx),
                resolveNode(imageClassificationNode, ctx),
                resolveNode(sectionsNode, ctx),
              ]);

            const renderingDir = path.resolve(
              ctx.outputRoot,
              ctx.label,
              "web-rendering"
            );
            fs.mkdirSync(renderingDir, { recursive: true });

            const totalPages = allPages.length;
            const results: (WebRendering | undefined)[] = new Array(totalPages);
            let completed = 0;

            const promptName =
              ctx.config.web_rendering?.prompt ?? "web_generation_html";

            const concurrency =
              ctx.config.web_rendering?.concurrency ?? DEFAULT_CONCURRENCY;

            async function processPage(i: number): Promise<void> {
              const p = allPages[i];
              const sectioning = allSectionings[i];

              // Read page image as base64
              const pageImageBase64 = fs
                .readFileSync(p.imagePath)
                .toString("base64");

              // Load extracted images for resolving part_ids to base64
              const bookDir = path.resolve(ctx.outputRoot, ctx.label);
              const allImagesForPage = loadUnprunedImagesFromDir(
                ctx.label,
                p.pageId,
                bookDir,
                allImageClassifications[i],
              );
              const imageMap = new Map(
                allImagesForPage.map((img) => [img.image_id, img.imageBase64])
              );

              // Render each non-pruned section
              const sectionRenderings = [];
              for (let si = 0; si < sectioning.sections.length; si++) {
                const section = sectioning.sections[si];
                if (section.is_pruned) continue;

                const { texts, images } = collectSectionInputs({
                  section,
                  sectioning,
                  imageMap,
                  pageId: p.pageId,
                });

                if (texts.length === 0 && images.length === 0) continue;

                const rendering = await renderSection({
                  label: ctx.label,
                  pageId: p.pageId,
                  model: resolveModel(ctx, ctx.config.web_rendering?.model),
                  pageImageBase64,
                  sectionIndex: si,
                  sectionType: section.section_type,
                  texts,
                  images,
                  promptName,
                  maxRetries: ctx.config.web_rendering?.max_retries ?? 2,
                });

                sectionRenderings.push(rendering);
              }

              const webRendering: WebRendering = {
                sections: sectionRenderings,
                page_sectioning_version: 1,
              };

              fs.writeFileSync(
                path.join(renderingDir, `${p.pageId}.json`),
                JSON.stringify(webRendering, null, 2) + "\n"
              );

              results[i] = webRendering;
              completed++;

              subscriber.next({
                phase: "rendering",
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

            subscriber.next(results as WebRendering[]);
            subscriber.complete();
          } catch (err) {
            subscriber.error(err);
          }
        })();
      }
    );
  },
}) as Node<WebRendering[]>;

export function renderWebPages(
  label: string,
  options?: { provider?: LLMProvider; outputRoot?: string }
): Observable<WebRenderingProgress> {
  const config = loadBookConfig(label);
  const ctx = createContext(label, {
    config,
    outputRoot: options?.outputRoot,
    provider: options?.provider ?? (config.provider as LLMProvider | undefined),
  });

  return new Observable<WebRenderingProgress>((subscriber) => {
    webRenderingNode.resolve(ctx).subscribe({
      next(v) {
        if (v && typeof v === "object" && "phase" in v && "label" in v) {
          subscriber.next(v as unknown as WebRenderingProgress);
        }
      },
      error: (err) => subscriber.error(err),
      complete: () => subscriber.complete(),
    });
  });
}
