#!/usr/bin/env node
/**
 * Pipeline CLI
 *
 * Run the book pipeline from the command line with parallel processing.
 *
 * Usage:
 *   pnpm pipeline run <label> <pdf_path>     Run full pipeline on a PDF
 *   pnpm pipeline pages <label>              Process pages for existing book
 *   pnpm pipeline page <label> <page_id>     Process a single page
 */

import fs from "node:fs";
import path from "node:path";
import {
  createPageRunner,
  createConsoleProgress,
  runExtract,
  runMetadataExtraction,
  runPagePipeline,
  nullProgress,
} from "../pipeline/runner";
import { getBooksRoot } from "../books";
import { ParallelProgress, runParallel } from "./progress";

const DEFAULT_CONCURRENCY = 16;

const USAGE = `Usage: pnpm pipeline <command> [args] [options]

Commands:
  run <label> <pdf_path>    Run full pipeline (extract + metadata + pages)
  pages <label>             Process all pages for an existing book
  page <label> <page_id>    Process a single page
  metadata <label>          Extract metadata only

Options:
  --start-page <n>      Start at page N (for run command)
  --end-page <n>        End at page N (for run command)
  --concurrency <n>     Max parallel page processing (default: ${DEFAULT_CONCURRENCY})
  --skip-cache          Skip LLM cache`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  // Parse flags
  const flags = parseFlags(args.slice(1));
  const positional = flags.positional;

  switch (command) {
    case "run": {
      const [label, pdfPath] = positional;
      if (!label || !pdfPath) {
        console.error("Usage: pnpm pipeline run <label> <pdf_path>");
        process.exit(1);
      }

      // Verify PDF exists
      if (!fs.existsSync(pdfPath)) {
        console.error(`PDF not found: ${pdfPath}`);
        process.exit(1);
      }

      // Initialize book directory if needed
      const booksRoot = getBooksRoot();
      const bookDir = path.join(booksRoot, label);
      if (!fs.existsSync(bookDir)) {
        console.log(`Creating book: ${label}`);
        fs.mkdirSync(bookDir, { recursive: true });
      }

      // Create runner with console progress for extraction/metadata
      const consoleProgress = createConsoleProgress();
      const runner = createPageRunner({
        label,
        progress: consoleProgress,
        skipCache: flags.skipCache,
      });

      console.log(`\nRunning pipeline for ${label}...\n`);

      // Step 1: Extract PDF
      const extractResult = await runExtract(
        {
          pdfPath,
          startPage: flags.startPage,
          endPage: flags.endPage,
        },
        runner.storage,
        consoleProgress
      );

      const pageIds = extractResult.pages.map((p) => p.pageId);
      console.log();

      // Step 2: Extract metadata
      const metadata = await runMetadataExtraction(runner);
      console.log();

      // Step 3: Process pages in parallel with dynamic progress
      if (pageIds.length > 0) {
        // Create silent runner for parallel processing (no console progress noise)
        const silentRunner = createPageRunner({
          label,
          progress: nullProgress,
          skipCache: flags.skipCache,
        });

        const progress = new ParallelProgress();
        progress.start(pageIds.length);

        await runParallel(
          pageIds,
          (pageId) => pageId,
          async (pageId) => {
            progress.updateTask(pageId, { step: "starting..." });
            await runPagePipeline(pageId, silentRunner);
          },
          {
            concurrency: flags.concurrency,
            progress,
          }
        );

        progress.stop();
      }

      // Summary
      console.log(`Title: ${metadata.title}`);
      console.log(`Authors: ${metadata.authors.join(", ")}`);
      break;
    }

    case "pages": {
      const [label] = positional;
      if (!label) {
        console.error("Usage: pnpm pipeline pages <label>");
        process.exit(1);
      }

      // Create silent runner for parallel processing
      const runner = createPageRunner({
        label,
        progress: nullProgress,
        skipCache: flags.skipCache,
      });

      const pageIds = await runner.storage.listPageIds();

      if (pageIds.length === 0) {
        console.log("No pages found.");
        process.exit(0);
      }

      console.log(`\nProcessing ${pageIds.length} pages for ${label}...\n`);

      const progress = new ParallelProgress();
      progress.start(pageIds.length);

      await runParallel(
        pageIds,
        (pageId) => pageId,
        async (pageId) => {
          progress.updateTask(pageId, { step: "starting..." });
          await runPagePipeline(pageId, runner);
        },
        {
          concurrency: flags.concurrency,
          progress,
        }
      );

      progress.stop();
      break;
    }

    case "page": {
      const [label, pageId] = positional;
      if (!label || !pageId) {
        console.error("Usage: pnpm pipeline page <label> <page_id>");
        process.exit(1);
      }

      const runner = createPageRunner({
        label,
        progress: createConsoleProgress(),
        skipCache: flags.skipCache,
      });

      console.log(`\nProcessing page ${pageId} for ${label}...\n`);
      await runPagePipeline(pageId, runner);
      console.log(`\nCompleted!`);
      break;
    }

    case "metadata": {
      const [label] = positional;
      if (!label) {
        console.error("Usage: pnpm pipeline metadata <label>");
        process.exit(1);
      }

      const runner = createPageRunner({
        label,
        progress: createConsoleProgress(),
        skipCache: flags.skipCache,
      });

      console.log(`\nExtracting metadata for ${label}...\n`);
      const metadata = await runMetadataExtraction(runner);
      console.log(`\nCompleted!`);
      console.log(`Title: ${metadata.title}`);
      console.log(`Authors: ${metadata.authors.join(", ")}`);
      console.log(`Language: ${metadata.language_code}`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

interface ParsedFlags {
  positional: string[];
  startPage?: number;
  endPage?: number;
  concurrency: number;
  skipCache: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  const positional: string[] = [];
  let startPage: number | undefined;
  let endPage: number | undefined;
  let concurrency = DEFAULT_CONCURRENCY;
  let skipCache = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--start-page" && args[i + 1]) {
      startPage = parseInt(args[++i], 10);
    } else if (arg === "--end-page" && args[i + 1]) {
      endPage = parseInt(args[++i], 10);
    } else if (arg === "--concurrency" && args[i + 1]) {
      concurrency = parseInt(args[++i], 10);
    } else if (arg === "--skip-cache") {
      skipCache = true;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return { positional, startPage, endPage, concurrency, skipCache };
}

main().catch((err) => {
  console.error("\nPipeline failed:", err.message);
  process.exit(1);
});
