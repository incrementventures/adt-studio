import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { PageImageClassification } from "./image-classification-schema";
import { classifyPageImages, type ImageInput } from "./classify-page-images";
import { loadBookConfig, getImageFilters } from "../../config";
import {
  defineNode,
  createContext,
  resolveNode,
  type LLMProvider,
  type Node,
} from "../node";
import { pagesNode, type Page } from "../extract/extract";

const DEFAULT_CONCURRENCY = 5;

export interface ImageClassificationProgress {
  phase: "loading" | "classifying";
  page?: number;
  totalPages?: number;
  label: string;
}

export const imageClassificationNode: Node<PageImageClassification[]> =
  defineNode<PageImageClassification[] | ImageClassificationProgress>({
    name: "image-classification",
    isComplete: (ctx) => {
      const dir = path.resolve(
        ctx.outputRoot,
        ctx.label,
        "image-classification"
      );
      if (!fs.existsSync(dir)) return null;
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^pg\d{3}\.json$/.test(f));
      if (files.length === 0) return null;
      const imagesDir = path.resolve(ctx.outputRoot, ctx.label, "images");
      if (fs.existsSync(imagesDir)) {
        const pageCount = fs
          .readdirSync(imagesDir)
          .filter((f) => /^pg\d{3}_page\.png$/.test(f)).length;
        if (files.length < pageCount) return null;
      }
      return files
        .sort()
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
    },
    resolve: (ctx) => {
      return new Observable<
        PageImageClassification[] | ImageClassificationProgress
      >((subscriber) => {
        (async () => {
          try {
            subscriber.next({ phase: "loading", label: ctx.label });

            const allPages = await resolveNode(pagesNode, ctx);

            const sizeFilter = getImageFilters(ctx.config).size;
            const classificationDir = path.resolve(
              ctx.outputRoot,
              ctx.label,
              "image-classification"
            );
            fs.mkdirSync(classificationDir, { recursive: true });

            const totalPages = allPages.length;
            const results: (PageImageClassification | undefined)[] = new Array(
              totalPages
            );
            let completed = 0;

            const concurrency =
              ctx.config.image_classification?.concurrency ??
              DEFAULT_CONCURRENCY;

            function processPage(i: number): void {
              const p = allPages[i];

              // Discover extracted images
              const imagesDir = path.dirname(p.imagePath);
              const imageInputs: ImageInput[] = [];
              if (fs.existsSync(imagesDir)) {
                const re = new RegExp(`^${p.pageId}_im\\d{3}\\.png$`, "i");
                const imageFiles = fs
                  .readdirSync(imagesDir)
                  .filter((f) => re.test(f))
                  .sort();
                for (const imgFile of imageFiles) {
                  const imageId = imgFile.replace(/\.png$/i, "");
                  const buf = fs.readFileSync(path.join(imagesDir, imgFile));
                  imageInputs.push({
                    image_id: imageId,
                    path: `images/${imgFile}`,
                    buf,
                  });
                }
              }

              const classification = classifyPageImages(
                imageInputs,
                sizeFilter
              );

              // Prepend the full page image as a pruned entry (available for cropping)
              if (fs.existsSync(p.imagePath)) {
                const pageBuf = fs.readFileSync(p.imagePath);
                classification.images.unshift({
                  image_id: `${p.pageId}_im000`,
                  path: `images/${p.pageId}_page.png`,
                  width: pageBuf.readUInt32BE(16),
                  height: pageBuf.readUInt32BE(20),
                  is_pruned: true,
                });
              }

              fs.writeFileSync(
                path.join(classificationDir, `${p.pageId}.json`),
                JSON.stringify(classification, null, 2) + "\n"
              );

              results[i] = classification;
              completed++;

              subscriber.next({
                phase: "classifying",
                page: completed,
                totalPages,
                label: ctx.label,
              });
            }

            // Process pages (no async needed — purely rule-based, no LLM calls)
            for (let i = 0; i < totalPages; i++) {
              processPage(i);
            }

            subscriber.next(results as PageImageClassification[]);
            subscriber.complete();
          } catch (err) {
            subscriber.error(err);
          }
        })();
      });
    },
  }) as Node<PageImageClassification[]>;

export function classifyImages(
  label: string,
  options?: { provider?: LLMProvider; outputRoot?: string }
): Observable<ImageClassificationProgress> {
  const config = loadBookConfig(label);
  const ctx = createContext(label, {
    config,
    outputRoot: options?.outputRoot,
    provider: options?.provider ?? (config.provider as LLMProvider | undefined),
  });

  return new Observable<ImageClassificationProgress>((subscriber) => {
    imageClassificationNode.resolve(ctx).subscribe({
      next(v) {
        if (v && typeof v === "object" && "phase" in v && "label" in v) {
          subscriber.next(v as unknown as ImageClassificationProgress);
        }
      },
      error: (err) => subscriber.error(err),
      complete: () => subscriber.complete(),
    });
  });
}
