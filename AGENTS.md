# ADT Studio

## What This Is

ADT Studio converts PDFs of learning materials (textbooks, storybooks, etc.) into Accessible Digital Textbooks (ADTs) — static websites that are fully accessible.

## Architecture

### Pipeline

- The core conversion is a **computation graph** of `Node<T>` values, orchestrated with **RxJS**.
- Each node declares its dependencies by calling `resolveNode()` on upstream nodes.
- Nodes read from and write to **static files on disk**, organized by book label.
- The pipeline and all logic around it must be **runnable from the command line** independent of the UI.
- Pipeline code lives separately from the Next.js app so it can be invoked via CLI without a browser.

#### Node pattern (`lib/pipeline/node.ts`)

Every pipeline step is a `Node<T>` created with `defineNode()`:

```ts
export const myNode: Node<OutputType> = defineNode<OutputType | ProgressType>({
  name: "my-node",
  isComplete: (ctx) => {
    // Return cached result from disk if already done, or null to run resolve()
  },
  resolve: (ctx) => {
    return new Observable<OutputType | ProgressType>((subscriber) => {
      (async () => {
        // 1. Resolve upstream dependencies
        const pages = await resolveNode(pagesNode, ctx);

        // 2. Do work, emitting progress events along the way
        subscriber.next({ phase: "working", label: ctx.label });

        // 3. Write results to disk
        // 4. Emit final value and complete
        subscriber.next(result);
        subscriber.complete();
      })();
    });
  },
}) as Node<OutputType>;
```

Key properties:
- **`isComplete`** — checks disk for existing output; returns the cached value or `null` to trigger `resolve()`.
- **`resolve`** — returns an `Observable` that emits progress events and a final result. Dependencies are pulled lazily via `resolveNode(upstreamNode, ctx)`.
- **Caching** — `defineNode` wraps the observable with `shareReplay` and stores it on `ctx.cache`, so multiple downstream consumers share one execution.
- **Progress + result union** — nodes emit both progress objects (for UI/CLI feedback) and a final typed result on the same observable. The convention is `defineNode<Result | Progress>` with a cast to `Node<Result>`.
- **CLI wrapper** — each module exports a convenience function (e.g., `extract()`, `extractMetadata()`, `extractText()`) that creates a `PipelineContext`, resolves the node, and re-emits only the progress events for CLI consumers.

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
- **RxJS** for the Node computation graph (caching, progress streaming, lazy resolution)
- **pnpm** for package management

## Testing

- **Unit tests are required** for all pipeline steps and shared logic.
- Each pipeline step should be independently testable and re-runnable.
- Use `assets/raven.pdf` as the sample PDF for any tests that need to do PDF extraction.
- Tests should be colocated or in a parallel `__tests__` directory structure.

## Pipeline Nodes

### `pagesNode` (`lib/pipeline/extract/extract.ts`)

Extracts all content from a PDF into a structured directory.

**Depends on:** nothing (root node)
**Input:** PDF file path (from `config.pdf_path`)
**Output:** `books/<label>/extract/pages/<pgNNN>/` with:
- `page.png` — full-page raster render (2x scale)
- `text.txt` — extracted text
- `images/` — embedded raster images (pgNNN_imNNN.png)

**Label** is derived by slugging the PDF filename (without extension): `My Book.pdf` → `my-book`.

**CLI:** `pnpm pipeline extract <pdf_path>`

### `metadataNode` (`lib/pipeline/metadata/metadata.ts`)

Sends the first pages of an extracted book to an LLM and writes structured metadata.

**Depends on:** `pagesNode`
**Output:** `books/<label>/metadata/metadata.json` with:
- `title` — book title (string | null)
- `authors` — list of author names
- `publisher` — publisher name (string | null)
- `language_code` — ISO 639-1 code (string | null)
- `cover_page_number` — page number of the front cover (int | null)
- `table_of_contents` — list of `{ title, page_number }` entries (array | null)
- `reasoning` — explanation of extraction decisions

**CLI:** `pnpm pipeline metadata <label> [--provider openai|anthropic|google]`

### `textExtractionNode` (`lib/pipeline/text-extraction/text-extraction.ts`)

Sends each page image to an LLM to extract structured text groups with reading order and type annotations.

**Depends on:** `pagesNode`, `metadataNode`
**Output:** `books/<label>/text-extraction/<pgNNN>.json` — one JSON file per page with text groups, reading order, and type labels.

**CLI:** `pnpm pipeline text-extraction <label> [--provider openai|anthropic|google]`

### `sectionsNode` (`lib/pipeline/page-sectioning/page-sectioning.ts`)

Groups text extraction results into semantic sections (e.g., "main body", "sidebar", "activity") per page, using configurable `section_types` from `config.yaml`.

**Depends on:** `pagesNode`, `textExtractionNode`
**Output:** `books/<label>/page-sectioning/<pgNNN>.json` — one JSON file per page with section assignments for each text group.

**CLI:** `pnpm pipeline page-sectioning <label> [--provider openai|anthropic|google]`

## Reference Repo: adt-press

The symlink `adt-press` in the project root points to a sibling Python project (Hamilton-based) that implements the same pipeline. Use it as inspiration when implementing our TypeScript version, but:

- **Never create dependencies** on adt-press (no imports, no shared modules, no runtime references).
- Prompts in `adt-press/prompts/` can be copied into this repo if needed.

## Conventions

- **DRY: Never duplicate logic between pipeline nodes and API routes.** If an API route needs the same transformation a pipeline node performs, extract a shared helper into the relevant schema or utility module and call it from both places. The API route for single-page sectioning and the `sectionsNode` pipeline node must use the same code path — not parallel implementations.
- Keep pipeline logic CLI-first. The UI is a convenience layer, not the source of truth.
- All pipeline steps are invoked via `pnpm pipeline <command>`. Run `pnpm pipeline` with no args for usage.
- Book data is addressed by label. Labels are URL-safe strings.
- Prefer static files over databases. No database.
