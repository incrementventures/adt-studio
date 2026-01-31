import fs from "node:fs";
import path from "node:path";
import { Observable } from "rxjs";
import type { LanguageModel, ModelMessage } from "ai";
import { cachedGenerateObject } from "../cache.js";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { pageTextExtractionSchema } from "./text-extraction-schema.js";
import { renderPrompt } from "../prompt.js";
import { getTextTypes, getTextGroupTypes } from "../../config.js";
import { defineStep } from "../step.js";
import { metadataStep } from "../metadata/metadata.js";
import type { LLMProvider, PipelineOptions } from "../types.js";

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

export const textExtractionStep = defineStep<TextExtractionProgress>({
  name: "text-extraction",
  deps: [metadataStep],
  isComplete: (paths) => {
    if (!fs.existsSync(paths.textExtractionDir)) return false;
    return fs
      .readdirSync(paths.textExtractionDir)
      .some((f) => /^pg\d{3}\.json$/.test(f));
  },
  execute: (paths, options) => {
    const provider = options.provider ?? "openai";

    return new Observable<TextExtractionProgress>((subscriber) => {
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
            .sort();

          // Read language from metadata.json
          let language = "en";
          if (fs.existsSync(paths.metadataFile)) {
            const metadata = JSON.parse(
              fs.readFileSync(paths.metadataFile, "utf-8")
            );
            if (metadata.language_code) {
              language = metadata.language_code;
            }
          }

          const totalPages = pageDirs.length;

          for (let i = 0; i < pageDirs.length; i++) {
            const dir = pageDirs[i];
            const pageDir = path.join(paths.pagesDir, dir);
            const imageBuffer = fs.readFileSync(
              path.join(pageDir, "page.png")
            );
            const text = fs.readFileSync(
              path.join(pageDir, "text.txt"),
              "utf-8"
            );

            const page = {
              pageNumber: parseInt(dir.slice(2), 10),
              text,
              imageBase64: imageBuffer.toString("base64"),
            };

            const textTypes = Object.entries(getTextTypes()).map(
              ([key, description]) => ({ key, description })
            );
            const textGroupTypes = Object.entries(getTextGroupTypes()).map(
              ([key, description]) => ({ key, description })
            );

            const promptMessages = await renderPrompt("text_extraction", {
              page,
              language,
              text_types: textTypes,
              text_group_types: textGroupTypes,
            });
            const systemMessage = promptMessages.find(
              (m) => m.role === "system"
            );
            const nonSystemMessages = promptMessages.filter(
              (m) => m.role !== "system"
            );

            const { object: extraction } = await cachedGenerateObject(
              {
                model: DEFAULT_MODELS[provider](),
                schema: pageTextExtractionSchema,
                system:
                  typeof systemMessage?.content === "string"
                    ? systemMessage.content
                    : undefined,
                messages: nonSystemMessages as ModelMessage[],
              },
              paths.textExtractionDir
            );

            fs.mkdirSync(paths.textExtractionDir, { recursive: true });
            fs.writeFileSync(
              path.join(paths.textExtractionDir, `${dir}.json`),
              JSON.stringify(extraction, null, 2) + "\n"
            );

            subscriber.next({
              phase: "extracting",
              page: i + 1,
              totalPages,
              label,
            });
          }

          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  },
});

export function extractText(
  label: string,
  options?: PipelineOptions
): Observable<TextExtractionProgress> {
  return textExtractionStep.run(label, options);
}
