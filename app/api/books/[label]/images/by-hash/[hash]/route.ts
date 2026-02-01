import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getBooksRoot, getImageByHash } from "@/lib/books";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { hashBase64 } from "@/lib/pipeline/llm-log";

const LABEL_RE = /^[a-z0-9-]+$/;
const HASH_RE = /^[0-9a-f]{16}$/;
const PAGE_RE = /^pg\d{3}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ label: string; hash: string }> }
) {
  const { label, hash } = await params;
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get("pageId") ?? "";

  if (!LABEL_RE.test(label) || !HASH_RE.test(hash)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }
  if (pageId && !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid pageId" }, { status: 400 });
  }

  const booksRoot = getBooksRoot();
  const { bookDir, imagesDir } = resolveBookPaths(label, booksRoot);

  // Fast path: DB lookup
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

  // Fallback: scan images/ directory
  const candidates: string[] = [];

  if (fs.existsSync(imagesDir)) {
    if (pageId) {
      // Scan for specific page images
      const pageImage = path.join(imagesDir, `${pageId}_page.png`);
      if (fs.existsSync(pageImage)) candidates.push(pageImage);

      const re = new RegExp(`^${pageId}_im\\d{3}\\.png$`);
      for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
        if (entry.isFile() && re.test(entry.name)) {
          candidates.push(path.join(imagesDir, entry.name));
        }
      }
    } else {
      // Scan all page images
      for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith("_page.png")) {
          candidates.push(path.join(imagesDir, entry.name));
        }
      }
    }
  }

  for (const filePath of candidates) {
    const buf = fs.readFileSync(filePath);
    const b64 = buf.toString("base64");
    const fileHash = hashBase64(b64);
    if (fileHash === hash) {
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
