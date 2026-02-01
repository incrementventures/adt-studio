import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import { cachedPromptGenerateObject } from "../cache";
import {
  buildLlmTextClassificationSchema,
  type PageTextClassification,
} from "./text-classification-schema";
import { getTextTypes, getTextGroupTypes, getPrunedTextTypes, loadBookConfig } from "../../config";
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

export interface TextClassificationProgress {
  phase: "loading" | "extracting";
  page?: number;
  totalPages?: number;
  label: string;
}

export const textClassificationNode: Node<PageTextClassification[]> = defineNode<
  PageTextClassification[] | TextClassificationProgress
>({
  name: "text-classification",
  isComplete: (ctx) => {
    const dir = path.resolve(ctx.outputRoot, ctx.label, "text-classification");
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => /^pg\d{3}\.json$/.test(f));
    if (files.length === 0) return null;
    // Check that every extracted page has a corresponding text-classification result
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
    return new Observable<PageTextClassification[] | TextClassificationProgress>(
      (subscriber) => {
        (async () => {
          try {
            subscriber.next({ phase: "loading", label: ctx.label });

            const [allPages, metadata] = await Promise.all([
              resolveNode(pagesNode, ctx),
              resolveNode(metadataNode, ctx),
            ]);

            const language = metadata.language_code ?? "en";
            const textClassificationDir = path.resolve(
              ctx.outputRoot,
              ctx.label,
              "text-classification"
            );
            fs.mkdirSync(textClassificationDir, { recursive: true });
            const totalPages = allPages.length;
            const results: (PageTextClassification | undefined)[] = new Array(
              totalPages
            );
            let completed = 0;

            const promptName =
              ctx.config.text_classification?.prompt ?? "text_classification";
            const textTypes = Object.entries(getTextTypes(ctx.config)).map(
              ([key, description]) => ({ key, description })
            );
            const textGroupTypes = Object.entries(getTextGroupTypes(ctx.config)).map(
              ([key, description]) => ({ key, description })
            );
            const textTypeKeys = Object.keys(getTextTypes(ctx.config)) as [string, ...string[]];
            const groupTypeKeys = Object.keys(getTextGroupTypes(ctx.config)) as [string, ...string[]];
            const llmPageTextClassificationSchema = buildLlmTextClassificationSchema(textTypeKeys, groupTypeKeys);

            const concurrency =
              ctx.config.text_classification?.concurrency ?? DEFAULT_CONCURRENCY;

            async function processPage(i: number): Promise<void> {
              const p = allPages[i];
              const imageBuffer = fs.readFileSync(p.imagePath);

              const page = {
                pageNumber: p.pageNumber,
                text: p.text,
                imageBase64: imageBuffer.toString("base64"),
              };

              const extraction =
                await cachedPromptGenerateObject<PageTextClassification>({
                  label: ctx.label,
                  taskType: "text-classification",
                  pageId: p.pageId,
                  model: resolveModel(ctx, ctx.config.text_classification?.model),
                  schema: llmPageTextClassificationSchema,
                  promptName,
                  promptContext: {
                    page,
                    language,
                    text_types: textTypes,
                    text_group_types: textGroupTypes,
                  },
                });

              // Assign stable group IDs and default is_pruned
              extraction.groups.forEach((g, idx) => {
                g.group_id =
                  p.pageId + "_gp" + String(idx + 1).padStart(3, "0");
                for (const t of g.texts) {
                  t.is_pruned = false;
                }
              });

              // Mark pruned text entries based on config
              const prunedTypes = getPrunedTextTypes(ctx.config);
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
                path.join(textClassificationDir, `${p.pageId}.json`),
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

            subscriber.next(results as PageTextClassification[]);
            subscriber.complete();
          } catch (err) {
            subscriber.error(err);
          }
        })();
      }
    );
  },
}) as Node<PageTextClassification[]>;

export function classifyText(
  label: string,
  options?: { provider?: LLMProvider; outputRoot?: string }
): Observable<TextClassificationProgress> {
  const config = loadBookConfig(label);
  const ctx = createContext(label, {
    config,
    outputRoot: options?.outputRoot,
    provider: options?.provider ?? (config.provider as LLMProvider | undefined),
  });

  return new Observable<TextClassificationProgress>((subscriber) => {
    textClassificationNode.resolve(ctx).subscribe({
      next(v) {
        if (v && typeof v === "object" && "phase" in v && "label" in v) {
          subscriber.next(v as unknown as TextClassificationProgress);
        }
      },
      error: (err) => subscriber.error(err),
      complete: () => subscriber.complete(),
    });
  });
}
