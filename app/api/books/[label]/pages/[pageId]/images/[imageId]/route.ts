import { NextResponse } from "next/server";
import fs from "node:fs";
import { resolveExtractedImagePath } from "@/lib/books";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;
const IMAGE_RE = /^pg\d{3}_im\d{3}$/;

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ label: string; pageId: string; imageId: string }> }
) {
  const { label, pageId, imageId } = await params;

  if (
    !LABEL_RE.test(label) ||
    !PAGE_RE.test(pageId) ||
    !IMAGE_RE.test(imageId)
  ) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const filePath = resolveExtractedImagePath(label, pageId, imageId);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
