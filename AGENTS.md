# ADT Studio

## What This Is

ADT Studio converts PDFs of learning materials (textbooks, storybooks, etc.) into Accessible Digital Textbooks (ADTs) — static websites that are fully accessible.

## Architecture

### Pipeline

The pipeline is built on **pure functions** with a **runner layer** for orchestration:

```
┌─────────────────────────────────────────────────────────────┐
│                        API Routes                           │
│                     Queue Executors                         │
├─────────────────────────────────────────────────────────────┤
│                   Actions (thin wrappers)                   │
│                   lib/pipeline/actions.ts                   │
├─────────────────────────────────────────────────────────────┤
│                    Runner Layer                             │
│                 lib/pipeline/runner/                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Storage  │  │ Progress │  │  Factory │  │ Runners  │   │
│  │ Adapter  │  │ Emitter  │  │          │  │          │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
├─────────────────────────────────────────────────────────────┤
│                     Pure Steps                              │
│                  lib/pipeline/steps/                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Extract  │  │ Metadata │  │ Classify │  │ Render   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
├─────────────────────────────────────────────────────────────┤
│                       Core                                  │
│                  lib/pipeline/core/                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │  Types   │  │ Schemas  │  │   LLM    │                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

#### Pure Steps (`lib/pipeline/steps/`)

Each pipeline step is a **pure function** that:
- Takes typed inputs (data, not file paths)
- Returns typed outputs
- Has no side effects (no file I/O, no database access)
- Receives LLM model as a parameter (if needed)

```ts
// Example: Text classification step
export async function classifyText(input: ClassifyTextInput): Promise<TextClassificationOutput> {
  const { page, pageImage, language, textTypes, model, promptName } = input;

  // Load prompt template
  const prompt = await loadPrompt(promptName, { page, textTypes, language });

  // Call LLM (model is injected, not created here)
  const result = await model.generateObject({ prompt, schema });

  return result;
}
```

Exception: `extractPdf` reads from a buffer but returns data for the caller to persist — it doesn't write to storage itself.

#### Core (`lib/pipeline/core/`)

Shared infrastructure:
- **Types** — `Page`, `PageImage`, `LLMModel`, etc.
- **Schemas** — Zod schemas for all pipeline outputs
- **LLM** — Model creation, prompt loading with LiquidJS

#### Runner Layer (`lib/pipeline/runner/`)

Orchestrates pure steps with storage and progress:

```ts
// Create a runner for a book
const runner = createPageRunner({
  label: "my-book",
  progress: createConsoleProgress(),
  skipCache: false,
});

// Run the full page pipeline
await runPagePipeline("pg001", runner);

// Or run individual steps
await runTextClassification("pg001", runner);
await runPageSectioning("pg001", runner);
await runWebRendering("pg001", runner);
```

Key components:
- **Storage Adapter** — Reads/writes to SQLite and filesystem
- **Progress Emitter** — Reports step progress via callbacks
- **Factory** — Creates runners from config
- **Book Runner** — Runs extract + metadata + all pages
- **Page Runner** — Runs classification + sectioning + rendering for one page

#### Actions (`lib/pipeline/actions.ts`)

Thin wrappers that create runners and call pure steps. Used by API routes and queue executors:

```ts
export async function runTextClassification(
  label: string,
  pageId: string,
  options?: { skipCache?: boolean }
): Promise<TextClassificationResult> {
  const runner = createRunner(label, { skipCache: options?.skipCache });
  return runTextClassificationImpl(pageId, runner);
}
```

### Storage

- All pipeline artifacts are stored in **SQLite databases** (one per book) and **image files**.
- Files are organized by book label (e.g., `books/<label>/`).
- The `Storage` interface abstracts all I/O so pure steps don't know about files.

### UI

- **Next.js** app for editing and monitoring pipelines.
- The UI is a frontend to the same pipeline logic — it does not contain business logic itself.
- The UI calls into shared pipeline code via API routes; it never reimplements pipeline steps.

## Tech Stack

- **TypeScript** throughout
- **Next.js** (App Router) for the UI
- **Vercel AI SDK** for LLM calls
- **pnpm** for package management

## CLI

The pipeline can be run from the command line with parallel processing:

```bash
# Run full pipeline (extract + metadata + all pages)
pnpm pipeline run <label> <pdf_path>

# Process all pages for an existing book
pnpm pipeline pages <label>

# Process a single page
pnpm pipeline page <label> <page_id>

# Extract metadata only
pnpm pipeline metadata <label>
```

Options:
- `--start-page <n>` — Start at page N
- `--end-page <n>` — End at page N
- `--concurrency <n>` — Max parallel page processing (default: 16)
- `--skip-cache` — Skip LLM cache

The CLI displays dynamic progress with animated spinners and a progress bar showing parallel task execution.

## Testing

- **Unit tests are required** for all pipeline steps and shared logic.
- Each pipeline step should be independently testable and re-runnable.
- Use `assets/raven.pdf` as the sample PDF for any tests that need to do PDF extraction.
- Tests should be colocated or in a parallel `__tests__` directory structure.

## Pipeline Steps

### Extract (`lib/pipeline/steps/extract.ts`)

Extracts all content from a PDF buffer.

**Input:** `{ pdfBuffer, startPage?, endPage? }`
**Output:** `{ pages: ExtractedPage[], pdfMetadata, totalPagesInPdf }`

Each `ExtractedPage` contains:
- `pageId` — e.g., `pg001`
- `pageNumber` — 1-indexed
- `text` — Extracted text
- `pageImage` — PNG buffer of full page render
- `images` — Embedded raster images

### Metadata (`lib/pipeline/steps/metadata.ts`)

Extracts book metadata from the first few pages.

**Input:** `{ pages, pageImages, model, promptName }`
**Output:** `BookMetadata` with title, authors, language, cover page, etc.

### Image Classification (`lib/pipeline/steps/image-classification.ts`)

Rule-based filtering by dimensions.

**Input:** `{ page }`
**Output:** `{ classifications }` — Maps image IDs to `{ is_pruned, pruning_reason }`

### Text Classification (`lib/pipeline/steps/text-classification.ts`)

LLM classifies page text into typed groups.

**Input:** `{ page, pageImage, language, textTypes, model, promptName }`
**Output:** `TextClassificationOutput` with ordered text groups

### Page Sectioning (`lib/pipeline/steps/page-sectioning.ts`)

LLM groups text and images into semantic sections.

**Input:** `{ page, textClassification, imageClassification, sectionTypes, model, promptName }`
**Output:** `PageSectioningOutput` with section assignments

### Web Rendering (`lib/pipeline/steps/web-rendering.ts`)

LLM renders sections as HTML.

**Input:** `{ section, texts, images, model, promptName }`
**Output:** `SectionRendering` with HTML, CSS, and metadata

## Conventions

- **DRY: Never duplicate logic between pipeline steps and API routes.** If an API route needs the same transformation a pipeline step performs, extract a shared helper and call it from both places.
- Keep pipeline logic CLI-first. The UI is a convenience layer, not the source of truth.
- All pipeline steps are invoked via `pnpm pipeline <command>`. Run `pnpm pipeline` with no args for usage.
- Book data is addressed by label. Labels are URL-safe strings.
- **Pure functions over side effects.** Pipeline steps should be deterministic given the same inputs.
- **Dependency injection.** LLM models and storage are passed in, not created inside steps.
