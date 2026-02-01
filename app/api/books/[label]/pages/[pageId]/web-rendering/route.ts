import { NextResponse } from "next/server";
import fs from "node:fs";
import {
  getTextClassification,
  getPageSectioning,
  resolvePageImagePath,
} from "@/lib/books";
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

  // Validate prerequisites exist before enqueuing
  const pageImagePath = resolvePageImagePath(label, pageId);
  if (!fs.existsSync(pageImagePath)) {
    return NextResponse.json(
      { error: "Page image not found" },
      { status: 404 }
    );
  }

  if (!getPageSectioning(label, pageId)) {
    return NextResponse.json(
      { error: "No page sectioning found — run sectioning first" },
      { status: 404 }
    );
  }

  if (!getTextClassification(label, pageId)) {
    return NextResponse.json(
      { error: "No text classification found for this page" },
      { status: 404 }
    );
  }

  const jobId = queue.enqueue("web-rendering", label, { pageId });
  return NextResponse.json({ jobId });
}
