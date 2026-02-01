[![Tests](https://github.com/incrementventures/adt-studio/actions/workflows/test.yml/badge.svg)](https://github.com/incrementventures/adt-studio/actions/workflows/test.yml)

# ADT Studio

ADT Studio converts PDFs of learning materials (textbooks, storybooks, etc.) into **Accessible Digital Textbooks** — structured, web-renderable HTML with classified text, images, and semantic sections. It provides a web UI for uploading books, running the pipeline, reviewing results, and manually editing outputs.

## Architecture

The app is a Next.js application backed by per-book SQLite databases. Books are processed through a six-stage pipeline that combines PDF rasterization, rule-based image filtering, and LLM-powered extraction.

### Pipeline stages

1. **Extract** — Rasterizes each PDF page to PNG via MuPDF, extracts embedded images and OCR text. No LLM required.
2. **Metadata** — Sends the first few pages to an LLM to extract title, authors, language, cover page, etc.
3. **Image Classification** — Rule-based filtering by dimensions. Marks small/oversized images as pruned. Supports manual cropping.
4. **Text Classification** — LLM classifies each page's text into typed, ordered groups (headings, paragraphs, stanzas, math, etc.) with pruning of headers/footers.
5. **Page Sectioning** — LLM groups text and images into semantic sections (text-only, text-and-images, activities, etc.).
6. **Web Rendering** — LLM renders each section as HTML. Includes validation that all text/image IDs are referenced. Supports versioning and manual editing via an annotation UI.

### Storage

Each book gets its own directory under `BOOKS_ROOT` (default: `books/`):

```
books/<label>/
  <label>.db           # SQLite database (schema v6, WAL mode)
  <label>.pdf          # Original PDF
  config.yaml          # Per-book config overrides
  images/
    pg001_page.png     # Full page render at ~144 DPI
    pg001_im001.png    # Embedded raster image
    pg001_im002.png    # Crop from image classification
```

All images live in a single flat `images/` directory per book. Page renders are named `{pageId}_page.png`, extracted images `{pageId}_im{NNN}.png`, and crops `{pageId}_im{NNN}.png` (next available number). The SQLite database stores page text, image metadata with content hashes, pipeline outputs (versioned), book metadata, and an LLM call log.

### Key dependencies

- **Next.js 16** (App Router, React 19)
- **Vercel AI SDK** with OpenAI, Anthropic, and Google providers
- **MuPDF** for PDF rasterization and text extraction
- **sharp** for image cropping
- **better-sqlite3** for per-book storage
- **RxJS** for the pipeline computation graph and progress streaming
- **LiquidJS** for prompt templates with custom `{% chat %}` / `{% image %}` tags

## Quick start

```bash
pnpm install
```

Create a `.env.local` with at least one LLM provider key:

```
OPENAI_API_KEY=sk-...
# and/or
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

Start the dev server:

```bash
pnpm dev
```

Open http://localhost:3000 and upload a PDF. The pipeline runs automatically — extraction first, then metadata, then per-page classification and rendering.

### CLI

Pipeline stages can also be run from the command line:

```bash
pnpm pipeline extract <pdf_path>
pnpm pipeline metadata <label> [--provider openai|anthropic|google]
pnpm pipeline image-classification <label>
pnpm pipeline text-classification <label> [--provider openai|anthropic|google]
pnpm pipeline page-sectioning <label> [--provider openai|anthropic|google]
```

## Configuration

Global defaults live in `config.yaml` at the project root. Per-book overrides go in `books/<label>/config.yaml` and are deep-merged on top.

Configurable settings include text types, section types, pruning rules, image size filters, per-stage LLM model selection, concurrency, and retry counts. See `lib/config.ts` for the full schema.

## Testing

Run the full test suite:

```bash
pnpm test
```

Other test commands:

```bash
pnpm test:watch         # Watch mode
pnpm test:integration   # Metadata + text-classification integration tests only
pnpm test:recache       # Re-run LLM calls (ignores cache, requires API key)
pnpm test:coverage      # Coverage report
```

Tests use a pre-built SQLite database at `fixtures/raven/raven.db` containing page text, image hashes, and LLM metadata for the raven fixture book. Integration tests set `BOOKS_ROOT=fixtures` so the pipeline finds this DB.

### Rebuilding fixtures

If you change the DB schema or fixture data, regenerate the fixture DB:

```bash
npx tsx fixtures/build-fixture-db.ts
```

This reads the fixture images from `fixtures/raven/images/` and `metadata.json`, then populates a fresh `raven.db` with the current schema. Commit the resulting `.db` file.
