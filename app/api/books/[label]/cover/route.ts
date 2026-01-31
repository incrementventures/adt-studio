import { NextResponse } from "next/server";
import fs from "node:fs";
import { resolveCoverImagePath } from "@/lib/books";

const LABEL_RE = /^[a-z0-9-]+$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ label: string }> }
) {
  const { label } = await params;

  if (!LABEL_RE.test(label)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const filePath = resolveCoverImagePath(label);
  if (!filePath || !fs.existsSync(filePath)) {
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
