import fs from "node:fs";
import path from "node:path";
import { getBooksRoot, putBookMetadata } from "@/lib/books";
import { closeDb, getDb } from "@/lib/db";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { loadBookConfig } from "@/lib/config";
import { extract } from "@/lib/pipeline/extract/extract";
import { queue } from "@/lib/queue";

const LABEL_RE = /^[a-z0-9-]+$/;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ label: string }> }
) {
  const { label } = await params;

  if (!LABEL_RE.test(label)) {
    return new Response(
      JSON.stringify({ error: "Invalid label" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);

  if (!fs.existsSync(paths.bookDir)) {
    return new Response(
      JSON.stringify({ error: "Book not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const pdfPath = path.join(paths.bookDir, `${label}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    return new Response(
      JSON.stringify({ error: "PDF not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Read config before we wipe anything (uses global + book config.yaml)
  let startPage: number | undefined;
  let endPage: number | undefined;
  try {
    const cfg = loadBookConfig(label);
    startPage = cfg.start_page;
    endPage = cfg.end_page;
  } catch {
    // Config read failed — proceed with defaults
  }

  // Close DB connection and delete the .db file
  closeDb(label);
  const dbPath = path.join(paths.bookDir, `${label}.db`);
  for (const ext of ["", "-wal", "-shm"]) {
    const f = dbPath + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // Delete pipeline output directories, keep config.yaml and PDF
  const dirsToDelete = [
    paths.imagesDir,
    paths.metadataDir,
    paths.textClassificationDir,
    paths.pageSectioningDir,
    paths.webRenderingDir,
  ];
  for (const dir of dirsToDelete) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // Delete legacy flat files if present
  const legacyFiles = ["llm-log.jsonl"];
  for (const file of legacyFiles) {
    const fp = path.join(paths.bookDir, file);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  // Ensure fresh DB exists
  getDb(label);

  // Stream extraction progress as NDJSON
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (obj: object) =>
    writer.write(encoder.encode(JSON.stringify(obj) + "\n"));

  const progress$ = extract(pdfPath, booksRoot, { startPage, endPage });

  progress$.subscribe({
    next(p) {
      write(p);
    },
    error(err) {
      write({ error: String(err) });
      writer.close();
    },
    complete() {
      putBookMetadata(label, "stub", {
        title: label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        authors: [],
        publisher: null,
        language_code: null,
        cover_page_number: 1,
        reasoning: "Auto-generated stub from reimport",
      });
      const jobId = queue.enqueue("metadata", label);
      write({ done: true, label, jobId });
      writer.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
