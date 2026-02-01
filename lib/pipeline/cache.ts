import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateObject } from "ai";
import type { GenerateObjectResult, LanguageModel, ModelMessage } from "ai";
import { renderPrompt } from "./prompt";

type GenerateObjectParams = Parameters<typeof generateObject>[0];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function cachedGenerateObject<T>(
  options: GenerateObjectParams,
  cacheDir: string,
  opts?: {
    validate?: (result: T) => ValidationResult;
    maxRetries?: number;
  },
): Promise<GenerateObjectResult<T>> {
  const cacheRoot = path.join(cacheDir, ".cache");
  const maxRetries = opts?.maxRetries ?? 0;

  let currentOptions = options;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const hash = computeHash(currentOptions);
    const cacheFile = path.join(cacheRoot, `${hash}.json`);

    try {
      let result: T;

      if (!process.env.RECACHE && fs.existsSync(cacheFile)) {
        result = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      } else {
        const generated = await generateObject(currentOptions);
        fs.mkdirSync(cacheRoot, { recursive: true });
        fs.writeFileSync(
          cacheFile,
          JSON.stringify(generated.object, null, 2) + "\n",
        );
        result = generated.object as T;
      }

      if (opts?.validate) {
        const check = opts.validate(result);
        if (!check.valid) {
          lastErrors = check.errors;
          bustCache(cacheFile);
          currentOptions = appendValidationFeedback(
            currentOptions,
            result,
            check.errors,
          );
          continue;
        }
      }

      return { object: result } as GenerateObjectResult<T>;
    } catch (err) {
      lastErrors = [err instanceof Error ? err.message : String(err)];
      bustCache(cacheFile);
      if (attempt === maxRetries) throw err;
    }
  }

  throw new Error(
    `Validation failed after ${maxRetries + 1} attempts. Errors:\n${lastErrors.join("\n")}`,
  );
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
  model: LanguageModel;
  schema: unknown;
  promptName: string;
  promptContext: Record<string, unknown>;
  cacheDir: string;
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
    options.cacheDir,
    { validate: options.validate, maxRetries: options.maxRetries },
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
