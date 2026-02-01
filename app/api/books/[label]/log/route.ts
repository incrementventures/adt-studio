import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getBooksRoot } from "@/lib/books";
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

  const logFile = path.join(getBooksRoot(), label, "llm-log.jsonl");
  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ entries: [] });
  }

  const lines = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
  const entries: LlmLogEntry[] = [];

  // Lines are chronological; walk backwards to collect entries newer than `after`
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = JSON.parse(lines[i]) as LlmLogEntry;
    if (after && entry.timestamp <= after) break;
    entries.push(entry);
  }

  return NextResponse.json({ entries });
}
