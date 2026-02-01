import { NextResponse } from "next/server";
import fs from "node:fs";
import { getBookMetadata, getBooksRoot } from "@/lib/books";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { extractMetadata } from "@/lib/pipeline/metadata/metadata";

const LABEL_RE = /^[a-z0-9-]+$/;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ label: string }> }
) {
  const { label } = await params;

  if (!LABEL_RE.test(label)) {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 });
  }

  const existing = getBookMetadata(label);
  if (!existing) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Remove existing metadata node output so the node re-runs the LLM
  const paths = resolveBookPaths(label, getBooksRoot());
  if (fs.existsSync(paths.metadataFile)) {
    fs.unlinkSync(paths.metadataFile);
  }

  // Stream NDJSON progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const obs = extractMetadata(label);

      obs.subscribe({
        next(progress) {
          controller.enqueue(
            encoder.encode(JSON.stringify(progress) + "\n")
          );
        },
        error(err) {
          const msg =
            err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(JSON.stringify({ error: msg }) + "\n")
          );
          controller.close();
        },
        complete() {
          const finalMetadata = getBookMetadata(label);
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ done: true, metadata: finalMetadata }) + "\n"
            )
          );
          controller.close();
        },
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
