import { NextResponse } from "next/server";
import {
  listWebRenderingVersions,
  getWebRenderingVersion,
  putNodeData,
} from "@/lib/books";

const LABEL_RE = /^[a-z0-9-]+$/;
const PAGE_RE = /^pg\d{3}$/;
const SECTION_ID_RE = /^pg\d{3}_s\d{3}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ label: string; pageId: string }> }
) {
  const { label, pageId } = await params;

  if (!LABEL_RE.test(label) || !PAGE_RE.test(pageId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const url = new URL(request.url);
  const sectionId = url.searchParams.get("sectionId");
  const vParam = url.searchParams.get("version");

  if (!sectionId || !SECTION_ID_RE.test(sectionId)) {
    return NextResponse.json(
      { error: "Missing or invalid sectionId" },
      { status: 400 }
    );
  }

  const version = vParam ? Number(vParam) : null;
  if (version === null || isNaN(version)) {
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

  const section = getWebRenderingVersion(label, sectionId, version);
  return NextResponse.json({ section, version });
}

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

  const data = getWebRenderingVersion(label, sectionId, version);
  if (!data) {
    return NextResponse.json(
      { error: "Version data not found" },
      { status: 404 }
    );
  }

  const nextVersion = versions[versions.length - 1] + 1;
  putNodeData(label, "web-rendering", sectionId, nextVersion, data);

  const updatedVersions = listWebRenderingVersions(label, sectionId);
  return NextResponse.json({ section: data, version: nextVersion, versions: updatedVersions });
}
