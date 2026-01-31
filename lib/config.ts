import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod/v4";

const configSchema = z.object({
  text_types: z.record(z.string(), z.string()),
  text_group_types: z.record(z.string(), z.string()),
  pdf_path: z.string().optional(),
  provider: z.enum(["openai", "anthropic", "google"]).optional(),
  metadata: z
    .object({
      prompt: z.string().optional(),
    })
    .optional(),
  text_extraction: z
    .object({
      prompt: z.string().optional(),
    })
    .optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(configPath?: string): AppConfig {
  const resolved = configPath ?? path.resolve(process.cwd(), "config.yaml");
  const raw = yaml.load(fs.readFileSync(resolved, "utf-8"));
  return configSchema.parse(raw);
}

// Module-level config for backwards compatibility (used by schema files, books.ts, web app)
const defaultConfigPath = path.resolve(process.cwd(), "config.yaml");
const raw = yaml.load(fs.readFileSync(defaultConfigPath, "utf-8"));
export const config: AppConfig = configSchema.parse(raw);

export function getTextTypes(): Record<string, string> {
  return config.text_types;
}

export function getTextGroupTypes(): Record<string, string> {
  return config.text_group_types;
}

export const textTypeKeys = Object.keys(
  config.text_types
) as [string, ...string[]];

export const groupTypeKeys = Object.keys(
  config.text_group_types
) as [string, ...string[]];
