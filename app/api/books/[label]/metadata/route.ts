import { NextResponse } from "next/server";
import fs from "node:fs";
import { getBookMetadata, getBooksRoot } from "@/lib/books";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { queue } from "@/lib/queue";

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

  const jobId = queue.enqueue("metadata", label);
  return NextResponse.json({ jobId });
}
