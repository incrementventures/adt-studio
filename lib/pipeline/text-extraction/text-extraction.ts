import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import { cachedPromptGenerateObject } from "../cache";
import {
  pageTextExtractionSchema,
  type PageTextExtraction,
} from "./text-extraction-schema";
import { getTextTypes, getTextGroupTypes, getPrunedTextTypes, loadConfig } from "../../config";
import {
  defineNode,
  createContext,
  resolveNode,
  resolveModel,
  type LLMProvider,
  type Node,
} from "../node";
import { pagesNode, type Page } from "../extract/extract";
import { metadataNode } from "../metadata/metadata";
import type { BookMetadata } from "../metadata/metadata-schema";

const DEFAULT_CONCURRENCY = 5;

export interface TextExtractionProgress {
  phase: "loading" | "extracting";
  page?: number;
  totalPages?: number;
  label: string;
}

export const textExtractionNode: Node<PageTextExtraction[]> = defineNode<
  PageTextExtraction[] | TextExtractionProgress
>({
  name: "text-extraction",
  isComplete: (ctx) => {
    const dir = path.resolve(ctx.outputRoot, ctx.label, "text-extraction");
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => /^pg\d{3}\.json$/.test(f));
    if (files.length === 0) return null;
    // Check that every extracted page has a corresponding text-extraction result
    const pagesDir = path.resolve(ctx.outputRoot, ctx.label, "extract", "pages");
    if (fs.existsSync(pagesDir)) {
      const pageCount = fs.readdirSync(pagesDir).filter((d) => /^pg\d{3}$/.test(d)).length;
      if (files.length < pageCount) return null;
    }
    return files.sort().map((f) =>
      JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))
    );
  },
  resolve: (ctx) => {
    return new Observable<PageTextExtraction[] | TextExtractionProgress>(
      (subscriber) => {
        (async () => {
          try {
            subscriber.next({ phase: "loading", label: ctx.label });

            const [allPages, metadata] = await Promise.all([
              resolveNode(pagesNode, ctx),
              resolveNode(metadataNode, ctx),
            ]);

            const language = metadata.language_code ?? "en";
            const textExtractionDir = path.resolve(
              ctx.outputRoot,
              ctx.label,
              "text-extraction"
            );
            fs.mkdirSync(textExtractionDir, { recursive: true });
            const totalPages = allPages.length;
            const results: (PageTextExtraction | undefined)[] = new Array(
              totalPages
            );
            let completed = 0;

            const promptName =
              ctx.config.text_extraction?.prompt ?? "text_extraction";
            const textTypes = Object.entries(getTextTypes()).map(
              ([key, description]) => ({ key, description })
            );
            const textGroupTypes = Object.entries(getTextGroupTypes()).map(
              ([key, description]) => ({ key, description })
            );

            const concurrency =
              ctx.config.text_extraction?.concurrency ?? DEFAULT_CONCURRENCY;

            async function processPage(i: number): Promise<void> {
              const p = allPages[i];
              const imageBuffer = fs.readFileSync(p.imagePath);

              const page = {
                pageNumber: p.pageNumber,
                text: p.text,
                imageBase64: imageBuffer.toString("base64"),
              };

              const extraction =
                await cachedPromptGenerateObject<PageTextExtraction>({
                  model: resolveModel(ctx, ctx.config.text_extraction?.model),
                  schema: pageTextExtractionSchema,
                  promptName,
                  promptContext: {
                    page,
                    language,
                    text_types: textTypes,
                    text_group_types: textGroupTypes,
                  },
                  cacheDir: textExtractionDir,
                });

              // Assign stable group IDs: pg###_gp###
              extraction.groups.forEach((g, idx) => {
                g.group_id =
                  p.pageId + "_gp" + String(idx + 1).padStart(3, "0");
              });

              // Mark pruned text entries based on config
              const prunedTypes = getPrunedTextTypes();
              if (prunedTypes.length > 0) {
                const prunedSet = new Set(prunedTypes);
                for (const g of extraction.groups) {
                  for (const t of g.texts) {
                    if (prunedSet.has(t.text_type)) {
                      t.is_pruned = true;
                    }
                  }
                }
              }

              fs.writeFileSync(
                path.join(textExtractionDir, `${p.pageId}.json`),
                JSON.stringify(extraction, null, 2) + "\n"
              );

              results[i] = extraction;
              completed++;

              subscriber.next({
                phase: "extracting",
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

            subscriber.next(results as PageTextExtraction[]);
            subscriber.complete();
          } catch (err) {
            subscriber.error(err);
          }
        })();
      }
    );
  },
}) as Node<PageTextExtraction[]>;

export function extractText(
  label: string,
  options?: { provider?: LLMProvider; outputRoot?: string }
): Observable<TextExtractionProgress> {
  const config = loadConfig();
  const ctx = createContext(label, {
    config,
    outputRoot: options?.outputRoot,
    provider: options?.provider ?? (config.provider as LLMProvider | undefined),
  });

  return new Observable<TextExtractionProgress>((subscriber) => {
    textExtractionNode.resolve(ctx).subscribe({
      next(v) {
        if (v && typeof v === "object" && "phase" in v && "label" in v) {
          subscriber.next(v as unknown as TextExtractionProgress);
        }
      },
      error: (err) => subscriber.error(err),
      complete: () => subscriber.complete(),
    });
  });
}
