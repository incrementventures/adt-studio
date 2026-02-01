import { NextResponse } from "next/server";
import { getBookMetadata, deleteBookMetadata } from "@/lib/books";
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

  // Remove existing LLM metadata so the node re-runs
  deleteBookMetadata(label, "llm");

  const jobId = queue.enqueue("metadata", label);
  return NextResponse.json({ jobId });
}
