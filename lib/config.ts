import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod/v4";

const configSchema = z.object({
  text_types: z.record(z.string(), z.string()),
  text_group_types: z.record(z.string(), z.string()),
});

export type AppConfig = z.infer<typeof configSchema>;

const configPath = path.resolve(process.cwd(), "config.yaml");

const raw = yaml.load(fs.readFileSync(configPath, "utf-8"));
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
