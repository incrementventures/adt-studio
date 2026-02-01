import { NextResponse } from "next/server";
import { getLlmLog } from "@/lib/books";
import type { LlmLogEntry } from "@/lib/pipeline/llm-log";

const LABEL_RE = /^[a-z0-9-]+$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ label: string }> }
) {
  const { label } = await params;
  if (!LABEL_RE.test(label)) {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const after = searchParams.get("after") ?? "";

  const allEntries = getLlmLog(label);

  // Entries are already newest-first from getLlmLog; filter by timestamp
  const entries: LlmLogEntry[] = [];
  for (const entry of allEntries) {
    if (after && entry.timestamp <= after) break;
    entries.push(entry);
  }

  return NextResponse.json({ entries });
}
