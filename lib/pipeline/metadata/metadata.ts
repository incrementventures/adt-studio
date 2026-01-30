import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { LanguageModelV1 } from "ai";
import { cachedGenerateObject } from "../cache.js";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { bookMetadataSchema } from "./metadata-schema.js";
import { renderPrompt } from "../prompt.js";

const MAX_PAGES = 15;

export type LLMProvider = "openai" | "anthropic" | "google";

const DEFAULT_MODELS: Record<LLMProvider, () => LanguageModelV1> = {
  openai: () => openai("gpt-5.2"),
  anthropic: () => anthropic("claude-sonnet-4-20250514"),
  google: () => google("gemini-2.5-pro"),
};

export interface MetadataProgress {
  phase: "loading" | "calling-llm" | "done";
  label: string;
}

export interface MetadataOptions {
  outputRoot?: string;
  provider?: LLMProvider;
}

export function extractMetadata(
  label: string,
  options: MetadataOptions = {}
): Observable<MetadataProgress> {
  const { outputRoot = "books", provider = "openai" } = options;
  const bookDir = path.resolve(outputRoot, label);
  const pagesDir = path.join(bookDir, "pages");

  return new Observable<MetadataProgress>((subscriber) => {
    (async () => {
      try {
        subscriber.next({ phase: "loading", label });

        if (!fs.existsSync(pagesDir)) {
          throw new Error(
            `Pages directory not found: ${pagesDir}. Run extract first.`
          );
        }

        const pageDirs = fs
          .readdirSync(pagesDir)
          .filter((d) => /^pg\d{3}$/.test(d))
          .sort()
          .slice(0, MAX_PAGES);

        const pages = pageDirs.map((dir) => {
          const pageDir = path.join(pagesDir, dir);
          const imageBuffer = fs.readFileSync(path.join(pageDir, "page.png"));
          const text = fs.readFileSync(
            path.join(pageDir, "text.txt"),
            "utf-8"
          );
          return {
            pageNumber: parseInt(dir.slice(2), 10),
            text,
            imageBase64: imageBuffer.toString("base64"),
          };
        });

        subscriber.next({ phase: "calling-llm", label });

        const promptMessages = await renderPrompt("metadata_extraction", { pages });
        const systemMessage = promptMessages.find((m) => m.role === "system");
        const nonSystemMessages = promptMessages.filter(
          (m) => m.role !== "system"
        );

        const { object: metadata } = await cachedGenerateObject({
          model: DEFAULT_MODELS[provider](),
          schema: bookMetadataSchema,
          system: typeof systemMessage?.content === "string"
            ? systemMessage.content
            : undefined,
          messages: nonSystemMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        }, bookDir);

        fs.writeFileSync(
          path.join(bookDir, "metadata.json"),
          JSON.stringify(metadata, null, 2) + "\n"
        );

        subscriber.next({ phase: "done", label });
        subscriber.complete();
      } catch (err) {
        subscriber.error(err);
      }
    })();
  });
}
