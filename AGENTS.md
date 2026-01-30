# ADT Studio

## What This Is

ADT Studio converts PDFs of learning materials (textbooks, storybooks, etc.) into Accessible Digital Textbooks (ADTs) — static websites that are fully accessible.

## Architecture

### Pipeline

- The core conversion is a multi-step pipeline built with **RxJS**.
- Each pipeline step reads from and writes to **static files on disk**, organized by book label.
- The pipeline and all logic around it must be **runnable from the command line** independent of the UI.
- Pipeline code lives separately from the Next.js app so it can be invoked via CLI without a browser.

### Storage

- All pipeline artifacts (intermediate and final) are stored as **static files**.
- Files are organized by book label (e.g., `books/<label>/`).
- Each pipeline step produces output files that subsequent steps consume.

### UI

- **Next.js** app for editing and monitoring pipelines.
- The UI is a frontend to the same pipeline logic — it does not contain business logic itself.
- The UI calls into shared pipeline code; it never reimplements pipeline steps.

## Tech Stack

- **TypeScript** throughout
- **Next.js** (App Router) for the UI
- **RxJS** for pipeline orchestration
- **pnpm** for package management

## Testing

- **Unit tests are required** for all pipeline steps and shared logic.
- Each pipeline step should be independently testable and re-runnable.
- Use `assets/raven.pdf` as the sample PDF for any tests that need to do PDF extraction.
- Tests should be colocated or in a parallel `__tests__` directory structure.

## Pipeline Steps

### Step 1: Extract (`lib/pipeline/extract.ts`)

Extracts all content from a PDF into a structured directory.

**Input:** PDF file path
**Output:** `books/<label>/pages/<NNN>/` with:
- `page.png` — full-page raster render (2x scale)
- `text.txt` — extracted text
- `images/` — embedded raster images (001.png, 002.png, …)

**Label** is derived by slugging the PDF filename (without extension): `My Book.pdf` → `my-book`.

**CLI:** `pnpm run extract <pdf_path>`

## Conventions

- Keep pipeline logic CLI-first. The UI is a convenience layer, not the source of truth.
- Book data is addressed by label. Labels are URL-safe strings.
- Prefer static files over databases. No database.
