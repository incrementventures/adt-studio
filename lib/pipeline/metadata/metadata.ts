import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { LanguageModel, ModelMessage } from "ai";
import { cachedGenerateObject } from "../cache.js";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { bookMetadataSchema } from "./metadata-schema.js";
import { renderPrompt } from "../prompt.js";
import { defineStep } from "../step.js";
import { extractStep } from "../extract/extract.js";
import type { LLMProvider, PipelineOptions } from "../types.js";

export type { LLMProvider } from "../types.js";

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

export const metadataStep = defineStep<MetadataProgress>({
  name: "metadata",
  deps: [extractStep],
  isComplete: (paths) => fs.existsSync(paths.metadataFile),
  execute: (paths, options) => {
    const provider = options.provider ?? "openai";

    return new Observable<MetadataProgress>((subscriber) => {
      (async () => {
        try {
          const label = path.basename(paths.bookDir);
          subscriber.next({ phase: "loading", label });

          if (!fs.existsSync(paths.pagesDir)) {
            throw new Error(
              `Pages directory not found: ${paths.pagesDir}. Run extract first.`
            );
          }

          const pageDirs = fs
            .readdirSync(paths.pagesDir)
            .filter((d) => /^pg\d{3}$/.test(d))
            .sort()
            .slice(0, MAX_PAGES);

          const pages = pageDirs.map((dir) => {
            const pageDir = path.join(paths.pagesDir, dir);
            const imageBuffer = fs.readFileSync(
              path.join(pageDir, "page.png")
            );
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

          const promptMessages = await renderPrompt("metadata_extraction", {
            pages,
          });
          const systemMessage = promptMessages.find(
            (m) => m.role === "system"
          );
          const nonSystemMessages = promptMessages.filter(
            (m) => m.role !== "system"
          );

          const { object: metadata } = await cachedGenerateObject(
            {
              model: DEFAULT_MODELS[provider](),
              schema: bookMetadataSchema,
              system:
                typeof systemMessage?.content === "string"
                  ? systemMessage.content
                  : undefined,
              messages: nonSystemMessages as ModelMessage[],
            },
            paths.metadataDir
          );

          fs.mkdirSync(paths.metadataDir, { recursive: true });
          fs.writeFileSync(
            paths.metadataFile,
            JSON.stringify(metadata, null, 2) + "\n"
          );

          subscriber.next({ phase: "done", label });
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  },
});

export function extractMetadata(
  label: string,
  options?: PipelineOptions
): Observable<MetadataProgress> {
  return metadataStep.run(label, options);
}
