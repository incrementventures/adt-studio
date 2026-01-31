import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { LanguageModel } from "ai";
import { cachedPromptGenerateObject } from "../cache.js";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { bookMetadataSchema, type BookMetadata } from "./metadata-schema.js";
import {
  defineNode,
  createContext,
  resolveNode,
  type PipelineContext,
  type LLMProvider,
  type Node,
} from "../node.js";
import { pagesNode, type Page } from "../extract/extract.js";
import { loadConfig } from "../../config.js";

export type { LLMProvider } from "../node.js";

const MAX_PAGES = 15;

const DEFAULT_MODELS: Record<LLMProvider, () => LanguageModel> = {
  openai: () => openai("gpt-5.2"),
  anthropic: () => anthropic("claude-sonnet-4-20250514"),
  google: () => google("gemini-2.5-pro"),
};

export interface MetadataProgress {
  phase: "loading" | "calling-llm" | "done";
  label: string;
}

export const metadataNode: Node<BookMetadata> = defineNode<
  BookMetadata | MetadataProgress
>({
  name: "metadata",
  isComplete: (ctx) => {
    const metadataFile = path.resolve(
      ctx.outputRoot,
      ctx.label,
      "metadata",
      "metadata.json"
    );
    if (!fs.existsSync(metadataFile)) return null;
    return JSON.parse(fs.readFileSync(metadataFile, "utf-8"));
  },
  resolve: (ctx) => {
    return new Observable<BookMetadata | MetadataProgress>((subscriber) => {
      (async () => {
        try {
          subscriber.next({ phase: "loading", label: ctx.label });

          const allPages = await resolveNode(pagesNode, ctx);

          const pages = allPages.slice(0, MAX_PAGES).map((p) => ({
            pageNumber: p.pageNumber,
            text: p.text,
            imageBase64: fs.readFileSync(p.imagePath).toString("base64"),
          }));

          subscriber.next({ phase: "calling-llm", label: ctx.label });

          const metadataDir = path.resolve(
            ctx.outputRoot,
            ctx.label,
            "metadata"
          );
          const metadataFile = path.join(metadataDir, "metadata.json");

          const metadata = await cachedPromptGenerateObject<BookMetadata>({
            model: DEFAULT_MODELS[ctx.provider](),
            schema: bookMetadataSchema,
            promptName: "metadata_extraction",
            promptContext: { pages },
            cacheDir: metadataDir,
          });

          fs.mkdirSync(metadataDir, { recursive: true });
          fs.writeFileSync(
            metadataFile,
            JSON.stringify(metadata, null, 2) + "\n"
          );

          subscriber.next({ phase: "done", label: ctx.label });
          subscriber.next(metadata);
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  },
}) as Node<BookMetadata>;

export function extractMetadata(
  label: string,
  options?: { provider?: LLMProvider; outputRoot?: string }
): Observable<MetadataProgress> {
  const config = loadConfig();
  const ctx = createContext(label, {
    config,
    outputRoot: options?.outputRoot,
    provider: options?.provider ?? (config.provider as LLMProvider | undefined),
  });

  return new Observable<MetadataProgress>((subscriber) => {
    metadataNode.resolve(ctx).subscribe({
      next(v) {
        if (v && typeof v === "object" && "phase" in v && "label" in v) {
          subscriber.next(v as unknown as MetadataProgress);
        }
      },
      error: (err) => subscriber.error(err),
      complete: () => subscriber.complete(),
    });
  });
}
