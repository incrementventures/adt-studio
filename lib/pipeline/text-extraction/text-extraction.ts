import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { LanguageModel } from "ai";
import { cachedPromptGenerateObject } from "../cache.js";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import {
  pageTextExtractionSchema,
  type PageTextExtraction,
} from "./text-extraction-schema.js";
import { getTextTypes, getTextGroupTypes, loadConfig } from "../../config.js";
import {
  defineNode,
  createContext,
  resolveNode,
  type LLMProvider,
  type Node,
} from "../node.js";
import { pagesNode, type Page } from "../extract/extract.js";
import { metadataNode } from "../metadata/metadata.js";
import type { BookMetadata } from "../metadata/metadata-schema.js";

const DEFAULT_MODELS: Record<LLMProvider, () => LanguageModel> = {
  openai: () => openai("gpt-5.2"),
  anthropic: () => anthropic("claude-sonnet-4-20250514"),
  google: () => google("gemini-2.5-pro"),
};

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
            const totalPages = allPages.length;
            const results: PageTextExtraction[] = [];

            const promptName =
              ctx.config.text_extraction?.prompt ?? "text_extraction";

            for (let i = 0; i < allPages.length; i++) {
              const p = allPages[i];
              const imageBuffer = fs.readFileSync(p.imagePath);

              const page = {
                pageNumber: p.pageNumber,
                text: p.text,
                imageBase64: imageBuffer.toString("base64"),
              };

              const textTypes = Object.entries(getTextTypes()).map(
                ([key, description]) => ({ key, description })
              );
              const textGroupTypes = Object.entries(getTextGroupTypes()).map(
                ([key, description]) => ({ key, description })
              );

              const extraction = await cachedPromptGenerateObject<PageTextExtraction>({
                model: DEFAULT_MODELS[ctx.provider](),
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

              fs.mkdirSync(textExtractionDir, { recursive: true });
              fs.writeFileSync(
                path.join(textExtractionDir, `${p.pageId}.json`),
                JSON.stringify(extraction, null, 2) + "\n"
              );

              results.push(extraction);

              subscriber.next({
                phase: "extracting",
                page: i + 1,
                totalPages,
                label: ctx.label,
              });
            }

            // Final emission is the result value
            subscriber.next(results);
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
