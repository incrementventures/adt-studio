import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateObject } from "ai";
import type { GenerateObjectResult, LanguageModel, ModelMessage } from "ai";
import { renderPrompt } from "./prompt";
import {
  appendLogEntry,
  resolveCacheDir,
  sanitizeMessages,
  type LlmLogEntry,
  type LlmLogTokenUsage,
} from "./llm-log";

type GenerateObjectParams = Parameters<typeof generateObject>[0];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function cachedGenerateObject<T>(
  options: GenerateObjectParams,
  opts: {
    validate?: (result: T) => ValidationResult;
    maxRetries?: number;
    log: {
      label: string;
      taskType: string;
      pageId?: string;
      promptName: string;
    };
  },
): Promise<GenerateObjectResult<T>> {
  const cacheRoot = path.join(resolveCacheDir(opts.log), ".cache");
  const maxRetries = opts?.maxRetries ?? 0;

  let currentOptions = options;
  let lastErrors: string[] = [];

  const modelId =
    typeof options.model === "string"
      ? options.model
      : options.model.modelId;

  const t0 = Date.now();
  let allErrors: string[] = [];
  let lastCacheHit = false;
  let finalAttempt = 0;
  const totalUsage: LlmLogTokenUsage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const hash = computeHash(currentOptions);
    const cacheFile = path.join(cacheRoot, `${hash}.json`);
    finalAttempt = attempt;

    try {
      let result: T;

      if (!process.env.RECACHE && fs.existsSync(cacheFile)) {
        result = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
        lastCacheHit = true;
      } else {
        const generated = await generateObject(currentOptions);
        fs.mkdirSync(cacheRoot, { recursive: true });
        fs.writeFileSync(
          cacheFile,
          JSON.stringify(generated.object, null, 2) + "\n",
        );
        result = generated.object as T;
        lastCacheHit = false;

        const u = generated.usage;
        totalUsage.inputTokens += u.inputTokens ?? 0;
        totalUsage.outputTokens += u.outputTokens ?? 0;
        totalUsage.cacheReadTokens = (totalUsage.cacheReadTokens ?? 0) + (u.inputTokenDetails?.cacheReadTokens ?? 0);
        totalUsage.cacheWriteTokens = (totalUsage.cacheWriteTokens ?? 0) + (u.inputTokenDetails?.cacheWriteTokens ?? 0);
      }

      if (opts.validate) {
        const check = opts.validate(result);
        if (!check.valid) {
          lastErrors = check.errors;
          allErrors.push(...check.errors);

          bustCache(cacheFile);
          currentOptions = appendValidationFeedback(
            currentOptions,
            result,
            check.errors,
          );
          continue;
        }
      }

      const withResponse = appendAssistantResponse(currentOptions, result);
      const durationMs = Date.now() - t0;
      const usage = totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0 ? totalUsage : undefined;
      writeLog(opts.log, modelId, lastCacheHit, attempt, durationMs, withResponse, usage, allErrors.length > 0 ? allErrors : undefined);

      return { object: result } as GenerateObjectResult<T>;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastErrors = [errMsg];
      allErrors.push(errMsg);
      bustCache(cacheFile);
      if (attempt === maxRetries) {
        const durationMs = Date.now() - t0;
        const usage = totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0 ? totalUsage : undefined;
        writeLog(opts.log, modelId, false, finalAttempt, durationMs, currentOptions, usage, allErrors);
        throw err;
      }
    }
  }

  const durationMs = Date.now() - t0;
  const usage = totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0 ? totalUsage : undefined;
  writeLog(opts.log, modelId, false, finalAttempt, durationMs, currentOptions, usage, allErrors);
  throw new Error(
    `Validation failed after ${maxRetries + 1} attempts. Errors:\n${lastErrors.join("\n")}`,
  );
}

function writeLog(
  log: { label: string; taskType: string; pageId?: string; promptName: string },
  modelId: string,
  cacheHit: boolean,
  attempt: number,
  durationMs: number,
  options: GenerateObjectParams,
  usage?: LlmLogTokenUsage,
  validationErrors?: string[],
): void {
  try {
    const entry: LlmLogEntry = {
      timestamp: new Date().toISOString(),
      label: log.label,
      taskType: log.taskType,
      pageId: log.pageId,
      promptName: log.promptName,
      modelId,
      cacheHit,
      attempt,
      durationMs,
      usage,
      validationErrors,
      system: typeof options.system === "string" ? options.system : undefined,
      messages: sanitizeMessages((options.messages ?? []) as ModelMessage[]),
    };
    appendLogEntry(entry);
  } catch {
    // Logging must never break the pipeline
  }
}

function appendAssistantResponse<T>(
  options: GenerateObjectParams,
  result: T,
): GenerateObjectParams {
  const currentMessages = (options.messages ?? []) as ModelMessage[];
  return {
    ...options,
    messages: [
      ...currentMessages,
      {
        role: "assistant" as const,
        content: JSON.stringify(result, null, 2),
      },
    ] as ModelMessage[],
  } as GenerateObjectParams;
}

function appendValidationFeedback<T>(
  options: GenerateObjectParams,
  failedResult: T,
  errors: string[],
): GenerateObjectParams {
  const currentMessages = (options.messages ?? []) as ModelMessage[];
  return {
    ...options,
    messages: [
      ...currentMessages,
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
    ] as ModelMessage[],
  } as GenerateObjectParams;
}

function bustCache(cacheFile: string): void {
  try {
    fs.unlinkSync(cacheFile);
  } catch {
    // Cache file may already be gone
  }
}

export async function cachedPromptGenerateObject<T>(options: {
  label: string;
  taskType: string;
  pageId?: string;
  model: LanguageModel;
  schema: unknown;
  promptName: string;
  promptContext: Record<string, unknown>;
  validate?: (result: T) => ValidationResult;
  maxRetries?: number;
}): Promise<T> {
  const promptMessages = await renderPrompt(
    options.promptName,
    options.promptContext,
  );
  const systemMessage = promptMessages.find((m) => m.role === "system");
  const nonSystemMessages = promptMessages.filter((m) => m.role !== "system");

  const { object } = await cachedGenerateObject<T>(
    {
      model: options.model,
      schema: options.schema,
      system:
        typeof systemMessage?.content === "string"
          ? systemMessage.content
          : undefined,
      messages: nonSystemMessages as ModelMessage[],
    } as GenerateObjectParams,
    {
      validate: options.validate,
      maxRetries: options.maxRetries,
      log: {
        label: options.label,
        taskType: options.taskType,
        pageId: options.pageId,
        promptName: options.promptName,
      },
    },
  );

  return object;
}

function computeHash(options: GenerateObjectParams): string {
  const model = options.model;
  const keyData = {
    modelId: typeof model === "string" ? model : model.modelId,
    system: options.system,
    messages: options.messages,
    schema: "schema" in options ? options.schema : undefined,
  };

  const json = JSON.stringify(keyData);
  return crypto.createHash("sha256").update(json).digest("hex");
}
