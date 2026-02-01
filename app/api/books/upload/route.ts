import fs from "node:fs";
import path from "node:path";
import { getBooksRoot } from "@/lib/books";
import { extract } from "@/lib/pipeline/extract/extract";
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

  // Save PDF named after the label so extract() derives the correct slug
  const pdfPath = path.join(bookDir, `${label}.pdf`);
  fs.mkdirSync(bookDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(pdfPath, buffer);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (obj: object) =>
    writer.write(encoder.encode(JSON.stringify(obj) + "\n"));

  const progress$ = extract(pdfPath, booksRoot);

  progress$.subscribe({
    next(p) {
      write(p);
    },
    error(err) {
      write({ error: String(err) });
      writer.close();
    },
    complete() {
      // Write stub metadata to extract dir so the book appears in listBooks().
      // The metadata node will later write real metadata to metadata/metadata.json.
      const extractDir = path.join(bookDir, "extract");
      const stubFile = path.join(extractDir, "pdf-metadata.json");
      if (!fs.existsSync(stubFile)) {
        const title = path.basename(file.name, ".pdf");
        fs.writeFileSync(
          stubFile,
          JSON.stringify(
            {
              title,
              authors: [],
              publisher: null,
              language_code: null,
              cover_page_number: 1,
              reasoning: "Auto-generated stub from PDF upload",
            },
            null,
            2
          )
        );
      }
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
