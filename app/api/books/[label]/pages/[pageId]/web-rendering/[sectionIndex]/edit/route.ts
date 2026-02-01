import { NextResponse } from "next/server";
import {
  getCurrentWebRenderingVersion,
  getWebRenderingVersion,
} from "@/lib/books";
import { queue } from "@/lib/queue";
import type { Annotation } from "@/lib/pipeline/web-rendering/edit-section";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;

export async function POST(
  request: Request,
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

  const body = await request.json();
  const {
    annotationImageBase64,
    annotations,
    currentHtml,
  } = body as {
    annotationImageBase64: string;
    annotations: Annotation[];
    currentHtml: string;
  };

  if (!annotationImageBase64 || !annotations || !currentHtml) {
    return NextResponse.json(
      { error: "Missing required fields: annotationImageBase64, annotations, currentHtml" },
      { status: 400 }
    );
  }

  // Validate section exists
  const sectionId = `${pageId}_s${String(sectionIndex).padStart(3, "0")}`;
  const currentVersion = getCurrentWebRenderingVersion(label, sectionId);
  const currentSection = getWebRenderingVersion(label, sectionId, currentVersion);
  if (!currentSection) {
    return NextResponse.json(
      { error: `Section ${sectionId} not found` },
      { status: 404 }
    );
  }

  const jobId = queue.enqueue("web-edit", label, {
    pageId,
    sectionIndex,
    annotationImageBase64,
    annotations,
    currentHtml,
  });
  return NextResponse.json({ jobId });
}
