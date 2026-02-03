/**
 * Runner Factory
 *
 * Creates a fully configured PageRunnerConfig from a book label.
 * This is the main entry point for setting up the pipeline.
 */

import path from "node:path";
import type { PageRunnerConfig, Progress, PromptConfig } from "./types";
import { nullProgress } from "./types";
import { createBookStorage } from "./storage-adapter";
import { createLLMModel, type LLMProvider } from "../core/llm";
import type { StepConfig, TypeDef } from "../core/types";
import {
  loadBookConfig,
  getTextTypes,
  getTextGroupTypes,
  getPrunedTextTypes,
  getPrunedSectionTypes,
  getSectionTypes,
  getImageFilters,
} from "@/lib/config";
import { getBooksRoot, getBookMetadata } from "@/lib/books";
import { appendLlmLog } from "@/lib/books";

// ============================================================================
// Factory options
// ============================================================================

export interface CreatePageRunnerOptions {
  label: string;
  progress?: Progress;
  skipCache?: boolean;
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a fully configured PageRunnerConfig for a book.
 *
 * This loads the configuration, creates storage, sets up the LLM model
 * with caching, and wires everything together.
 */
export function createPageRunner(
  options: CreatePageRunnerOptions
): PageRunnerConfig {
  const { label, progress = nullProgress, skipCache = false } = options;

  // Load configuration
  const bookConfig = loadBookConfig(label);
  const metadata = getBookMetadata(label);
  const booksRoot = getBooksRoot();

  // Build step config from book config
  const rawFilters = getImageFilters(bookConfig).size ?? {};
  const config: StepConfig = {
    language: metadata?.language_code ?? "en",
    textTypes: recordToTypeDefs(getTextTypes(bookConfig)),
    textGroupTypes: recordToTypeDefs(getTextGroupTypes(bookConfig)),
    sectionTypes: recordToTypeDefs(getSectionTypes(bookConfig)),
    prunedTextTypes: getPrunedTextTypes(bookConfig),
    prunedSectionTypes: getPrunedSectionTypes(bookConfig),
    imageFilters: {
      minSide: rawFilters.min_side,
      maxSide: rawFilters.max_side,
    },
  };

  // Build prompt config
  const prompts: PromptConfig = {
    metadata: bookConfig.metadata?.prompt ?? "metadata_extraction",
    textClassification:
      bookConfig.text_classification?.prompt ?? "text_classification",
    pageSectioning: bookConfig.page_sectioning?.prompt ?? "page_sectioning",
    webRendering: bookConfig.web_rendering?.prompt ?? "web_generation_html",
    sectionEdit: "web_edit",
  };

  // Create LLM model with caching
  const provider = (bookConfig.provider as LLMProvider | undefined) ?? "openai";
  const cacheDir = path.join(booksRoot, label, ".cache");

  const model = createLLMModel({
    provider,
    modelId: bookConfig.text_classification?.model,
    cacheDir,
    skipCache,
    onLog: (entry) => {
      // Log to the book's LLM log table
      try {
        appendLlmLog(label, { ...entry, label });
      } catch {
        // Don't fail the pipeline on logging errors
      }
    },
  });

  // Create storage
  const storage = createBookStorage(label);

  return {
    storage,
    progress,
    config,
    model,
    prompts,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function recordToTypeDefs(record: Record<string, string>): TypeDef[] {
  return Object.entries(record).map(([key, description]) => ({
    key,
    description,
  }));
}
