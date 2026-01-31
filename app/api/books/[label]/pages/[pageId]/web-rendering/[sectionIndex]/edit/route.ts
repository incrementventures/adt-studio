import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getBooksRoot,
  getCurrentWebRenderingVersion,
  getWebRenderingVersion,
  listWebRenderingVersions,
  setCurrentWebRenderingVersion,
} from "@/lib/books";
import { loadConfig } from "@/lib/config";
import { resolveBookPaths } from "@/lib/pipeline/types";
import { createContext, resolveModel } from "@/lib/pipeline/node";
import type { LLMProvider } from "@/lib/pipeline/node";
import { editSection, type Annotation } from "@/lib/pipeline/web-rendering/edit-section";

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

  const sectionId = `${pageId}_s${String(sectionIndex).padStart(3, "0")}`;

  const config = loadConfig();
  const booksRoot = getBooksRoot();
  const paths = resolveBookPaths(label, booksRoot);
  const renderingDir = paths.webRenderingDir;

  // Read current version of this section
  const currentVersion = getCurrentWebRenderingVersion(label, sectionId);
  const currentSection = getWebRenderingVersion(label, sectionId, currentVersion);
  if (!currentSection) {
    return NextResponse.json(
      { error: `Section ${sectionId} not found` },
      { status: 404 }
    );
  }

  const ctx = createContext(label, {
    config,
    outputRoot: booksRoot,
    provider: (config.provider as LLMProvider | undefined) ?? "openai",
  });
  const model = resolveModel(ctx, config.web_rendering?.model);

  const result = await editSection({
    model,
    currentHtml,
    annotationImageBase64,
    annotations,
    cacheDir: renderingDir,
  });

  // Build updated section
  const updatedSection = {
    ...currentSection,
    html: result.html,
    reasoning: result.reasoning,
  };

  // Compute next version and write versioned file
  const existingVersions = listWebRenderingVersions(label, sectionId);
  const nextVersion =
    existingVersions.length > 0
      ? Math.max(...existingVersions) + 1
      : 2;

  fs.writeFileSync(
    path.join(
      renderingDir,
      `${sectionId}.v${String(nextVersion).padStart(3, "0")}.json`
    ),
    JSON.stringify(updatedSection, null, 2) + "\n"
  );
  setCurrentWebRenderingVersion(label, sectionId, nextVersion);

  const updatedVersions = listWebRenderingVersions(label, sectionId);
  return NextResponse.json({
    section: updatedSection,
    version: nextVersion,
    versions: updatedVersions,
  });
}
