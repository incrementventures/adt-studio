import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getBooksRoot, getImageByHash } from "@/lib/books";
import { resolveBookPaths } from "@/lib/pipeline/types";

const LABEL_RE = /^[a-z0-9-]+$/;
const HASH_RE = /^[0-9a-f]{16}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ label: string; hash: string }> }
) {
  const { label, hash } = await params;

  if (!LABEL_RE.test(label) || !HASH_RE.test(hash)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const booksRoot = getBooksRoot();
  const { bookDir } = resolveBookPaths(label, booksRoot);

  const relPath = getImageByHash(label, hash);
  if (relPath) {
    const absPath = path.join(bookDir, relPath);
    if (fs.existsSync(absPath)) {
      const buf = fs.readFileSync(absPath);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
