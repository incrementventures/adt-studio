/**
 * Book Runner
 *
 * Orchestrates the full book pipeline:
 * 1. PDF extraction
 * 2. Metadata extraction
 * 3. Page-level processing (classification, sectioning, rendering)
 */

import fs from "node:fs";
import type { Storage, Progress, PageRunnerConfig, RunOptions } from "./types";
import { extractPdf, extractMetadata } from "../steps";
import type { BookMetadata, ExtractResult, ExtractProgress } from "../steps";
import { runPagePipeline } from "./page-runner";

// ============================================================================
// Extract runner
// ============================================================================

export interface ExtractOptions {
  pdfPath: string;
  startPage?: number;
  endPage?: number;
}

/**
 * Run PDF extraction for a book.
 *
 * This reads the PDF, extracts pages/images/text, and writes to storage.
 */
export async function runExtract(
  options: ExtractOptions,
  storage: Storage,
  progress: Progress
): Promise<ExtractResult> {
  const { pdfPath, startPage, endPage } = options;

  progress.emit({ type: "book-step-start", step: "extract" });

  try {
    // Read PDF into buffer
    const pdfBuffer = fs.readFileSync(pdfPath);

    // Extract pages
    const result = await extractPdf(
      { pdfBuffer, startPage, endPage },
      (p: ExtractProgress) => {
        progress.emit({
          type: "book-step-progress",
          step: "extract",
          message: `Extracting page ${p.page}`,
          page: p.page,
          totalPages: p.totalPages,
        });
      }
    );

    // Save PDF metadata
    await storage.putPdfMetadata(result.pdfMetadata);

    // Save extracted pages
    for (const page of result.pages) {
      await storage.putExtractedPage(page);
    }

    progress.emit({ type: "book-step-complete", step: "extract" });

    return result;
  } catch (err) {
    progress.emit({
      type: "book-step-error",
      step: "extract",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ============================================================================
// Metadata runner
// ============================================================================

const DEFAULT_METADATA_PAGES = 3;

/**
 * Run metadata extraction for a book.
 *
 * This reads the first few pages and uses an LLM to extract book metadata.
 */
export async function runMetadataExtraction(
  runner: PageRunnerConfig,
  pageCount?: number
): Promise<BookMetadata> {
  const { storage, progress, model, prompts } = runner;

  progress.emit({ type: "book-step-start", step: "metadata" });

  try {
    progress.emit({
      type: "book-step-progress",
      step: "metadata",
      message: "Loading pages",
    });

    // Get first N pages
    const pages = await storage.getFirstPages(pageCount ?? DEFAULT_METADATA_PAGES);

    if (pages.length === 0) {
      throw new Error("No pages available for metadata extraction");
    }

    progress.emit({
      type: "book-step-progress",
      step: "metadata",
      message: "Calling LLM",
    });

    // Extract metadata
    const metadata = await extractMetadata({
      pages,
      model,
      promptName: prompts.metadata,
    });

    // Save metadata
    await storage.putBookMetadata(metadata, "llm");

    progress.emit({ type: "book-step-complete", step: "metadata" });

    return metadata;
  } catch (err) {
    progress.emit({
      type: "book-step-error",
      step: "metadata",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ============================================================================
// Full book pipeline
// ============================================================================

export interface BookPipelineOptions {
  pdfPath: string;
  startPage?: number;
  endPage?: number;
  /** Skip metadata extraction step */
  skipMetadata?: boolean;
  /** Skip page-level processing (only extract PDF) */
  skipPages?: boolean;
  /** Options for page-level processing */
  pageOptions?: RunOptions;
}

/**
 * Run the full book pipeline:
 * 1. Extract PDF pages
 * 2. Extract book metadata
 * 3. Process each page (classification, sectioning, rendering)
 *
 * Returns the list of page IDs and extracted metadata.
 */
export async function runBookPipeline(
  options: BookPipelineOptions,
  runner: PageRunnerConfig
): Promise<{ pageIds: string[]; metadata?: BookMetadata }> {
  const { storage, progress } = runner;

  // Step 1: Extract PDF
  const extractResult = await runExtract(
    {
      pdfPath: options.pdfPath,
      startPage: options.startPage,
      endPage: options.endPage,
    },
    storage,
    progress
  );

  const pageIds = extractResult.pages.map((p) => p.pageId);

  // Step 2: Extract metadata (unless skipped)
  let metadata: BookMetadata | undefined;
  if (!options.skipMetadata) {
    metadata = await runMetadataExtraction(runner);
  }

  // Step 3: Process each page (unless skipped)
  if (!options.skipPages) {
    progress.emit({ type: "book-step-start", step: "pages" });

    try {
      for (let i = 0; i < pageIds.length; i++) {
        const pageId = pageIds[i];
        progress.emit({
          type: "book-step-progress",
          step: "pages",
          message: `Processing page ${pageId}`,
          page: i + 1,
          totalPages: pageIds.length,
        });
        await runPagePipeline(pageId, runner, options.pageOptions);
      }
      progress.emit({ type: "book-step-complete", step: "pages" });
    } catch (err) {
      progress.emit({
        type: "book-step-error",
        step: "pages",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  return { pageIds, metadata };
}
