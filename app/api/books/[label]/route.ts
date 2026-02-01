import { NextResponse } from "next/server";
import fs from "node:fs";
import { getBooksRoot } from "@/lib/books";
import { closeDb } from "@/lib/db";
import { resolveBookPaths } from "@/lib/pipeline/types";

const LABEL_RE = /^[a-z0-9-]+$/;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ label: string }> }
) {
  const { label } = await params;

  if (!LABEL_RE.test(label)) {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 });
  }

  const paths = resolveBookPaths(label, getBooksRoot());

  if (!fs.existsSync(paths.bookDir)) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  closeDb(label);
  fs.rmSync(paths.bookDir, { recursive: true, force: true });

  return NextResponse.json({ deleted: true });
}
