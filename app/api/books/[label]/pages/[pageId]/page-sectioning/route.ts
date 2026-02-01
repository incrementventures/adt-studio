import { NextResponse } from "next/server";
import fs from "node:fs";
import {
  getTextClassification,
  resolvePageImagePath,
} from "@/lib/books";
import { loadBookConfig } from "@/lib/config";
import { queue } from "@/lib/queue";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const config = loadBookConfig(label);
  const sectionTypes = config.section_types ?? {};
  if (Object.keys(sectionTypes).length === 0) {
    return NextResponse.json(
      { error: "No section_types defined in config" },
      { status: 400 }
    );
  }

  // Validate prerequisites
  const pageImagePath = resolvePageImagePath(label, pageId);
  if (!fs.existsSync(pageImagePath)) {
    return NextResponse.json(
      { error: "Page image not found" },
      { status: 404 }
    );
  }

  if (!getTextClassification(label, pageId)) {
    return NextResponse.json(
      { error: "No text classification found for this page" },
      { status: 404 }
    );
  }

  const jobId = queue.enqueue("page-sectioning", label, { pageId });
  return NextResponse.json({ jobId });
}
