import { NextResponse } from "next/server";
import {
  listWebRenderingVersions,
  getWebRenderingVersion,
  setCurrentWebRenderingVersion,
} from "@/lib/books";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;
const SECTION_ID_RE = /^pg\d{3}_s\d{3}$/;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const body = await request.json();
  const { sectionId, version } = body;

  if (typeof sectionId !== "string" || !SECTION_ID_RE.test(sectionId)) {
    return NextResponse.json(
      { error: "Missing or invalid sectionId" },
      { status: 400 }
    );
  }

  if (typeof version !== "number") {
    return NextResponse.json(
      { error: "Missing or invalid version" },
      { status: 400 }
    );
  }

  const versions = listWebRenderingVersions(label, sectionId);
  if (!versions.includes(version)) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  setCurrentWebRenderingVersion(label, sectionId, version);

  const section = getWebRenderingVersion(label, sectionId, version);
  return NextResponse.json({ section, version });
}
