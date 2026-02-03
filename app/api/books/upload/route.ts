import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { getBooksRoot, putBookMetadata } from "@/lib/books";
import { getDb } from "@/lib/db";
import { runExtract, createBookStorage, nullProgress } from "@/lib/pipeline/runner";
import { queue } from "@/lib/queue";

const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("pdf");
  const labelRaw = formData.get("label");

  if (!(file instanceof File) || !file.name.endsWith(".pdf")) {
    return new Response(
      JSON.stringify({ error: "A .pdf file is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (typeof labelRaw !== "string" || !LABEL_RE.test(labelRaw)) {
    return new Response(
      JSON.stringify({ error: "A valid label is required (lowercase alphanumeric with hyphens)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const label = labelRaw;
  const booksRoot = getBooksRoot();
  const bookDir = path.join(booksRoot, label);

  if (fs.existsSync(bookDir)) {
    return new Response(
      JSON.stringify({ error: `A book with label "${label}" already exists` }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse optional page range
  const startPageRaw = formData.get("start_page");
  const endPageRaw = formData.get("end_page");
  const startPage =
    typeof startPageRaw === "string" && startPageRaw
      ? parseInt(startPageRaw, 10)
      : undefined;
  const endPage =
    typeof endPageRaw === "string" && endPageRaw
      ? parseInt(endPageRaw, 10)
      : undefined;

  if (startPage !== undefined && (!Number.isInteger(startPage) || startPage < 1)) {
    return new Response(
      JSON.stringify({ error: "start_page must be a positive integer" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (endPage !== undefined && (!Number.isInteger(endPage) || endPage < 1)) {
    return new Response(
      JSON.stringify({ error: "end_page must be a positive integer" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Save PDF named after the label so extract() derives the correct slug
  const pdfPath = path.join(bookDir, `${label}.pdf`);
  fs.mkdirSync(bookDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(pdfPath, buffer);

  // Write book config.yaml
  const bookConfig: Record<string, unknown> = {
    pdf_path: `${label}.pdf`,
  };
  if (startPage !== undefined) bookConfig.start_page = startPage;
  if (endPage !== undefined) bookConfig.end_page = endPage;
  fs.writeFileSync(path.join(bookDir, "config.yaml"), yaml.dump(bookConfig));

  // Ensure DB exists
  getDb(label);

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
      const title = path.basename(file.name, ".pdf");
      putBookMetadata(label, "stub", {
        title,
        authors: [],
        publisher: null,
        language_code: null,
        cover_page_number: 1,
        reasoning: "Auto-generated stub from PDF upload",
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
