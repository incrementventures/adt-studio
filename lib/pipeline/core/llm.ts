/**
 * LLM abstraction with caching support.
 *
 * This module provides a clean interface for LLM calls that:
 * - Wraps the Vercel AI SDK
 * - Handles disk-based caching of responses
 * - Supports validation with retry loops
 * - Logs all calls for debugging
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateObject, type LanguageModel, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type {
  LLMModel,
  GenerateObjectOptions,
  GenerateObjectResult,
  Message,
  TokenUsage,
} from "./types";
import { renderPrompt, type PromptMessage } from "../prompt";

type GenerateObjectParams = Parameters<typeof generateObject>[0];

// ============================================================================
// Provider types and model resolution
// ============================================================================

export type LLMProvider = "openai" | "anthropic" | "google";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
};

const MODEL_FACTORIES: Record<LLMProvider, (id: string) => LanguageModel> = {
  openai: (id) => openai(id),
  anthropic: (id) => anthropic(id),
  google: (id) => google(id),
};

export function resolveLanguageModel(
  provider: LLMProvider,
  modelId?: string
): LanguageModel {
  const id = modelId ?? DEFAULT_MODELS[provider];

  // Handle "provider:model-id" format
  if (modelId?.includes(":")) {
    const [p, m] = modelId.split(":", 2);
    return MODEL_FACTORIES[p as LLMProvider](m);
  }

  return MODEL_FACTORIES[provider](id);
}

// ============================================================================
// LLM Model factory
// ============================================================================

export interface CreateLLMModelOptions {
  provider: LLMProvider;
  modelId?: string;
  cacheDir?: string;
  skipCache?: boolean;
  onLog?: (entry: LLMLogEntry) => void;
}

export interface LLMLogEntry {
  timestamp: string;
  taskType: string;
  pageId?: string;
  promptName: string;
  modelId: string;
  cacheHit: boolean;
  attempt: number;
  durationMs: number;
  usage?: TokenUsage;
  validationErrors?: string[];
  system?: string;
  messages: LLMLogMessage[];
}

export interface LLMLogMessage {
  role: string;
  content: LLMLogContentPart[];
}

export interface LLMLogContentPart {
  type: "text" | "image";
  text?: string;
  // For images, store metadata instead of full base64
  width?: number;
  height?: number;
  byteLength?: number;
  hash?: string;
}

/**
 * Create an LLMModel instance with optional caching.
 *
 * This is the main entry point for creating LLM clients in the pipeline.
 */
export function createLLMModel(options: CreateLLMModelOptions): LLMModel {
  const languageModel = resolveLanguageModel(options.provider, options.modelId);
  const modelId = options.modelId ?? DEFAULT_MODELS[options.provider];

  return {
    async generateObject<T>(
      opts: GenerateObjectOptions
    ): Promise<GenerateObjectResult<T>> {
      const cacheDir = options.cacheDir;
      const maxRetries = opts.maxRetries ?? 0;
      const t0 = Date.now();

      let currentMessages = opts.messages;
      let allErrors: string[] = [];
      let lastCacheHit = false;
      let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const hash = computeHash({
          modelId,
          system: opts.system,
          messages: currentMessages,
          schema: opts.schema,
        });

        const cacheFile = cacheDir ? path.join(cacheDir, `${hash}.json`) : null;

        try {
          let result: T;

          // Check cache
          if (
            cacheFile &&
            !options.skipCache &&
            !process.env.RECACHE &&
            fs.existsSync(cacheFile)
          ) {
            result = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
            lastCacheHit = true;
          } else {
            // Call LLM
            const aiMessages = convertMessages(currentMessages);
            const generated = await generateObject({
              model: languageModel,
              schema: opts.schema,
              system: opts.system,
              messages: aiMessages,
            } as GenerateObjectParams);

            result = generated.object as T;
            lastCacheHit = false;

            // Update usage stats
            const u = generated.usage;
            totalUsage.inputTokens += u.inputTokens ?? 0;
            totalUsage.outputTokens += u.outputTokens ?? 0;

            // Write cache
            if (cacheFile) {
              fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
              fs.writeFileSync(
                cacheFile,
                JSON.stringify(result, null, 2) + "\n"
              );
            }
          }

          // Validate if validator provided
          if (opts.validate) {
            const check = opts.validate(result);
            if (!check.valid) {
              allErrors.push(...check.errors);

              // Bust cache and retry with feedback
              if (cacheFile) bustCache(cacheFile);
              currentMessages = appendValidationFeedback(
                currentMessages,
                result,
                check.errors
              );
              continue;
            }
          }

          // Log and return
          const durationMs = Date.now() - t0;
          if (opts.log) {
            options.onLog?.({
              timestamp: new Date().toISOString(),
              taskType: opts.log.taskType,
              pageId: opts.log.pageId,
              promptName: opts.log.promptName,
              modelId,
              cacheHit: lastCacheHit,
              attempt,
              durationMs,
              usage:
                totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0
                  ? totalUsage
                  : undefined,
              validationErrors: allErrors.length > 0 ? allErrors : undefined,
              system: opts.system,
              messages: messagesToLogFormat(currentMessages),
            });
          }

          return {
            object: result,
            usage: totalUsage,
            cached: lastCacheHit,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          allErrors.push(errMsg);
          if (cacheFile) bustCache(cacheFile);

          if (attempt === maxRetries) {
            const durationMs = Date.now() - t0;
            if (opts.log) {
              options.onLog?.({
                timestamp: new Date().toISOString(),
                taskType: opts.log.taskType,
                pageId: opts.log.pageId,
                promptName: opts.log.promptName,
                modelId,
                cacheHit: false,
                attempt,
                durationMs,
                usage:
                  totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0
                    ? totalUsage
                    : undefined,
                validationErrors: allErrors,
                system: opts.system,
                messages: messagesToLogFormat(currentMessages),
              });
            }
            throw err;
          }
        }
      }

      // Should never reach here, but TypeScript needs this
      throw new Error(
        `Validation failed after ${maxRetries + 1} attempts. Errors:\n${allErrors.join("\n")}`
      );
    },
  };
}

// ============================================================================
// Prompt loading helper
// ============================================================================

/**
 * Load and render a Liquid prompt template, returning messages in our format.
 */
export async function loadPrompt(
  templateName: string,
  context: Record<string, unknown>
): Promise<{ system?: string; messages: Message[] }> {
  const promptMessages = await renderPrompt(templateName, context);

  const systemMsg = promptMessages.find((m) => m.role === "system");
  const nonSystemMsgs = promptMessages.filter((m) => m.role !== "system");

  return {
    system: typeof systemMsg?.content === "string" ? systemMsg.content : undefined,
    messages: nonSystemMsgs.map(convertPromptMessage),
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

function computeHash(data: {
  modelId: string;
  system?: string;
  messages: Message[];
  schema: unknown;
}): string {
  const json = JSON.stringify(data);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function bustCache(cacheFile: string): void {
  try {
    fs.unlinkSync(cacheFile);
  } catch {
    // Cache file may already be gone
  }
}

function convertMessages(messages: Message[]): ModelMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content } as ModelMessage;
    }

    // Convert content parts
    const parts = m.content.map((p) => {
      if (p.type === "text") {
        return { type: "text" as const, text: p.text };
      } else {
        return {
          type: "image" as const,
          image: p.image,
        };
      }
    });

    return { role: m.role, content: parts } as ModelMessage;
  });
}

function convertPromptMessage(msg: PromptMessage): Message {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }

  // Convert AI SDK content parts to our format
  const parts = msg.content.map((p) => {
    if (p.type === "text") {
      return { type: "text" as const, text: p.text };
    } else if (p.type === "image") {
      return { type: "image" as const, image: (p as { image: string }).image };
    }
    throw new Error(`Unknown content part type: ${(p as { type: string }).type}`);
  });

  return { role: msg.role, content: parts };
}

function appendValidationFeedback<T>(
  messages: Message[],
  failedResult: T,
  errors: string[]
): Message[] {
  return [
    ...messages,
    {
      role: "assistant" as const,
      content: JSON.stringify(failedResult, null, 2),
    },
    {
      role: "user" as const,
      content:
        "Your previous response failed validation with these errors:\n" +
        errors.map((e) => `- ${e}`).join("\n") +
        "\n\nPlease fix these issues and try again.",
    },
  ];
}

/**
 * Convert messages to log format, replacing image data with metadata.
 */
function messagesToLogFormat(messages: Message[]): LLMLogMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return {
        role: m.role,
        content: [{ type: "text" as const, text: m.content }],
      };
    }

    const content: LLMLogContentPart[] = m.content.map((p) => {
      if (p.type === "text") {
        return { type: "text" as const, text: p.text };
      } else {
        // For images, store metadata instead of full base64
        const base64 = p.image;
        // Hash the base64 string directly (not the decoded bytes) to match existing scheme
        const hash = crypto.createHash("sha256").update(base64).digest("hex").slice(0, 16);
        const byteLength = Math.round((base64.length * 3) / 4);

        // Try to get dimensions from PNG header (decode just first 32 chars)
        let width = 0;
        let height = 0;
        try {
          const headerBuf = Buffer.from(base64.slice(0, 32), "base64");
          if (headerBuf.length >= 24) {
            width = headerBuf.readUInt32BE(16);
            height = headerBuf.readUInt32BE(20);
          }
        } catch {
          // Ignore dimension extraction errors
        }

        return {
          type: "image" as const,
          width,
          height,
          byteLength,
          hash,
        };
      }
    });

    return { role: m.role, content };
  });
}
