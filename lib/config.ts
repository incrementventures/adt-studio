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
      model: z.string().optional(),
    })
    .optional(),
  text_classification: z
    .object({
      prompt: z.string().optional(),
      model: z.string().optional(),
      concurrency: z.number().int().min(1).optional(),
    })
    .optional(),
  start_page: z.number().int().min(1).optional(),
  end_page: z.number().int().min(1).optional(),
  section_types: z.record(z.string(), z.string()).optional(),
  pruned_text_types: z.array(z.string()).optional(),
  pruned_section_types: z.array(z.string()).optional(),
  page_sectioning: z
    .object({
      prompt: z.string().optional(),
      model: z.string().optional(),
      concurrency: z.number().int().min(1).optional(),
    })
    .optional(),
  image_classification: z
    .object({
      prompt: z.string().optional(),
      model: z.string().optional(),
      concurrency: z.number().int().min(1).optional(),
    })
    .optional(),
  web_rendering: z
    .object({
      prompt: z.string().optional(),
      model: z.string().optional(),
      concurrency: z.number().int().min(1).optional(),
      max_retries: z.number().int().min(0).optional(),
    })
    .optional(),
  image_filters: z
    .object({
      size: z
        .object({
          min_side: z.number().optional(),
          max_side: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Deep-merge two plain objects. Plain objects recurse;
 * arrays and primitives: override wins.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overrides: Record<string, unknown>
): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(overrides)) {
    const baseVal = result[key];
    const overVal = overrides[key];
    if (
      baseVal !== null &&
      overVal !== null &&
      typeof baseVal === "object" &&
      typeof overVal === "object" &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>
      );
    } else {
      result[key] = overVal;
    }
  }
  return result as T;
}

export function loadConfig(configPath?: string): AppConfig {
  const resolved = configPath ?? path.resolve(process.cwd(), "config.yaml");
  const raw = yaml.load(fs.readFileSync(resolved, "utf-8"));
  return configSchema.parse(raw);
}

export function loadBookConfig(label: string): AppConfig {
  const base = loadConfig();
  const bookConfigPath = path.join(
    path.resolve(process.env.BOOKS_ROOT ?? "books"),
    label,
    "config.yaml"
  );
  if (!fs.existsSync(bookConfigPath)) return base;
  const overrides = yaml.load(fs.readFileSync(bookConfigPath, "utf-8"));
  return configSchema.parse(
    deepMerge(base, overrides as Record<string, unknown>)
  );
}

export function getTextTypes(cfg: AppConfig): Record<string, string> {
  return cfg.text_types;
}

export function getTextGroupTypes(cfg: AppConfig): Record<string, string> {
  return cfg.text_group_types;
}

export function getPrunedTextTypes(cfg: AppConfig): string[] {
  return cfg.pruned_text_types ?? [];
}

export function getPrunedSectionTypes(cfg: AppConfig): string[] {
  return cfg.pruned_section_types ?? [];
}

export function getSectionTypes(cfg: AppConfig): Record<string, string> {
  return cfg.section_types ?? {};
}

export function getImageFilters(cfg: AppConfig): {
  size?: { min_side?: number; max_side?: number };
} {
  return cfg.image_filters ?? {};
}
