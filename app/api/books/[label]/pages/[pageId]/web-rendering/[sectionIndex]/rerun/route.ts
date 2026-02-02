import { NextResponse } from "next/server";
import { listWebRenderingVersions } from "@/lib/books";
import { queue } from "@/lib/queue";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ label: string; pageId: string; sectionIndex: string }>;
  }
) {
  const { label, pageId, sectionIndex: sectionIndexStr } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const sectionIndex = parseInt(sectionIndexStr, 10);
  if (isNaN(sectionIndex) || sectionIndex < 0) {
    return NextResponse.json(
      { error: "Invalid section index" },
      { status: 400 }
    );
  }

  // Validate section exists
  const sectionId = `${pageId}_s${String(sectionIndex + 1).padStart(3, "0")}`;
  const sectionVersions = listWebRenderingVersions(label, sectionId);
  if (sectionVersions.length === 0) {
    return NextResponse.json(
      { error: `Section ${sectionId} not found` },
      { status: 404 }
    );
  }

  const jobId = queue.enqueue("web-rendering-section", label, {
    pageId,
    sectionIndex,
  });
  return NextResponse.json({ jobId });
}
