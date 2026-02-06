import fs from "node:fs";
import path from "node:path";
import { getBooksRoot, putBookMetadata } from "@/lib/books";
import { closeDb, getDb, undeleteDb } from "@/lib/db";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { loadBookConfig } from "@/lib/config";
import { runExtract, createBookStorage } from "@/lib/pipeline/runner";
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

  // Cancel any running/queued jobs for this book before reimporting
  queue.cancelByLabel(label);

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

  // Re-allow DB access and create fresh DB
  undeleteDb(label);
  getDb(label);

  // Stream extraction progress as NDJSON
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (obj: object) =>
    writer.write(encoder.encode(JSON.stringify(obj) + "\n"));

  // Run extraction asynchronously
  (async () => {
    try {
      const storage = createBookStorage(label);

      // Create a progress emitter that writes to the stream
      const streamProgress = {
        emit(event: { type: string; page?: number; totalPages?: number; message?: string }) {
          if (event.type === "book-step-progress" && event.page !== undefined) {
            write({ page: event.page, totalPages: event.totalPages });
          }
        },
      };

      const result = await runExtract(
        { pdfPath, startPage, endPage },
        storage,
        streamProgress
      );

      // Write stub metadata to DB so the book appears in listBooks().
      putBookMetadata(label, "stub", {
        title: label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        authors: [],
        publisher: null,
        language_code: null,
        cover_page_number: 1,
        reasoning: "Auto-generated stub from reimport",
      });

      const jobId = queue.enqueue("metadata", label);
      write({ done: true, label, jobId, totalPages: result.totalPagesInPdf });
    } catch (err) {
      write({ error: String(err) });
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
