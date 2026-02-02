import Link from "next/link";
import {
  listPages,
  getTextClassification,
  listTextClassificationVersions,
  getPageSectioning,
  getImageClassification,
  listImageClassificationVersions,
  getImageHashes,
  getWebRendering,
} from "@/lib/books";
import { loadBookConfig, getSectionTypes } from "@/lib/config";
import { TextClassificationPanel } from "../extract/text-classification-panel";
import { ImageClassificationPanel } from "../extract/image-classification-panel";
import { SectionsPanel } from "../sections/sections-panel";
import { WebRenderingPanel } from "./web-rendering-panel";
import { PipelineSSEProvider } from "../use-pipeline-refresh";

export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const pages = listPages(label);
  const bookConfig = loadBookConfig(label);
  const textTypeKeys = Object.keys(bookConfig.text_types);
  const groupTypeKeys = Object.keys(bookConfig.text_group_types);
  const sectionTypes = getSectionTypes(bookConfig);

  return (
    <PipelineSSEProvider label={label}>
    <div>
      <div>
        {pages.map((page, i) => {
          const extraction = getTextClassification(label, page.pageId);
          const availableVersions = listTextClassificationVersions(label, page.pageId);
          const sectioning = getPageSectioning(label, page.pageId);
          const webRenderingResult = getWebRendering(label, page.pageId);
          const imageClassificationResult = getImageClassification(label, page.pageId);
          const imageClassificationVersions = listImageClassificationVersions(label, page.pageId);
          const imageHashes = getImageHashes(label, page.pageId);
          return (
            <section
              key={page.pageId}
              id={page.pageId}
              className="scroll-mt-16"
            >
              <Link
                href={`/books/${label}/pages/${page.pageId}`}
                className="flex items-center gap-3 py-4 text-faint hover:text-foreground transition-colors"
              >
                <div className="h-0.5 flex-1 bg-border" />
                <span className="shrink-0 text-sm font-bold uppercase tracking-wider">page {i + 1}</span>
                <div className="h-0.5 flex-1 bg-border" />
              </Link>

              <div className="overflow-hidden rounded-lg border border-border">
              {/* Image Classification */}
              <ImageClassificationPanel
                label={label}
                pageId={page.pageId}
                pageIndex={i}
                imageIds={page.imageIds}
                initialClassification={imageClassificationResult?.data ?? null}
                initialVersion={imageClassificationResult?.version ?? 1}
                availableVersions={imageClassificationVersions}
                initialImageHashes={imageHashes}
              />

              {/* Text Classification */}
              <TextClassificationPanel
                label={label}
                pageId={page.pageId}
                initialData={extraction?.data ?? null}
                initialVersion={extraction?.version ?? 1}
                availableVersions={availableVersions}
                textTypes={textTypeKeys}
                groupTypes={groupTypeKeys}
              />

              {/* Sections */}
              <SectionsPanel
                label={label}
                pageId={page.pageId}
                sectioning={sectioning}
                extraction={extraction?.data ?? null}
                imageIds={page.imageIds}
                sectionTypes={sectionTypes}
              />

              {/* Web Pages */}
              <WebRenderingPanel
                label={label}
                pageId={page.pageId}
                sections={webRenderingResult?.sections ?? null}
              />
              </div>
            </section>
          );
        })}
      </div>
    </div>
    </PipelineSSEProvider>
  );
}
