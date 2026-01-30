import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateObject } from "ai";
import type { GenerateObjectResult } from "ai";

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

function computeHash(options: GenerateObjectParams): string {
  const keyData = {
    modelId: options.model.modelId,
    system: options.system,
    messages: options.messages,
    schema: options.schema,
  };

  const json = JSON.stringify(keyData);
  return crypto.createHash("sha256").update(json).digest("hex");
}
