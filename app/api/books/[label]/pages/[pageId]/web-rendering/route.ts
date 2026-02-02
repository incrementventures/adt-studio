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

  const sectioningResult = getPageSectioning(label, pageId);
  if (!sectioningResult) {
    return NextResponse.json(
      { error: "No page sectioning found — run sectioning first" },
      { status: 404 }
    );
  }
  const sectioning = sectioningResult.data;

  if (!getTextClassification(label, pageId)) {
    return NextResponse.json(
      { error: "No text classification found for this page" },
      { status: 404 }
    );
  }

  // Enqueue one job per non-pruned section so they run in parallel
  const jobIds: string[] = [];
  for (let si = 0; si < sectioning.sections.length; si++) {
    const section = sectioning.sections[si];
    if (section.is_pruned) continue;

    // Check that the section has content (part_ids with texts or images)
    if (!section.part_ids || section.part_ids.length === 0) continue;

    const jobId = queue.enqueue("web-rendering-section", label, {
      pageId,
      sectionIndex: si,
    });
    jobIds.push(jobId);
  }

  if (jobIds.length === 0) {
    return NextResponse.json(
      { error: "No renderable sections found" },
      { status: 400 }
    );
  }

  return NextResponse.json({ jobIds });
}
