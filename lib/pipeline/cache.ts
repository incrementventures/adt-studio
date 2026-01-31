import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateObject } from "ai";
import type { GenerateObjectResult, LanguageModel, ModelMessage } from "ai";
import { renderPrompt } from "./prompt.js";

type GenerateObjectParams = Parameters<typeof generateObject>[0];

export async function cachedGenerateObject<T>(
  options: GenerateObjectParams,
  cacheDir: string
): Promise<GenerateObjectResult<T>> {
  const cacheRoot = path.join(cacheDir, ".cache");
  const hash = computeHash(options);
  const cacheFile = path.join(cacheRoot, `${hash}.json`);

  if (!process.env.RECACHE && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    return { object: cached } as GenerateObjectResult<T>;
  }

  const result = await generateObject(options);

  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result.object, null, 2) + "\n");

  return result as GenerateObjectResult<T>;
}

export async function cachedPromptGenerateObject<T>(options: {
  model: LanguageModel;
  schema: unknown;
  promptName: string;
  promptContext: Record<string, unknown>;
  cacheDir: string;
}): Promise<T> {
  const promptMessages = await renderPrompt(
    options.promptName,
    options.promptContext
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
    options.cacheDir
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
