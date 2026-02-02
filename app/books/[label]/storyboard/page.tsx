import {
  listPages,
  getTextClassification,
  listTextClassificationVersions,
  getPageSectioning,
  getImageClassification,
  listImageClassificationVersions,
  getImageHashes,
  listPageSectioningVersions,
  getWebRendering,
} from "@/lib/books";
import { loadBookConfig, getSectionTypes } from "@/lib/config";
import { TextClassificationPanel } from "../extract/text-classification-panel";
import { ImageClassificationPanel } from "../extract/image-classification-panel";
import { SectionsPanel } from "../sections/sections-panel";
import { WebRenderingPanel } from "./web-rendering-panel";
import { StoryboardPageRow } from "./storyboard-page-row";
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
          const sectioningResult = getPageSectioning(label, page.pageId);
          const sectioningVersions = listPageSectioningVersions(label, page.pageId);
          const webRenderingResult = getWebRendering(label, page.pageId);
          const imageClassificationResult = getImageClassification(label, page.pageId);
          const imageClassificationVersions = listImageClassificationVersions(label, page.pageId);
          const imageHashes = getImageHashes(label, page.pageId);
          return (
            <section
              key={page.pageId}
              id={page.pageId}
              className="mb-6 scroll-mt-16"
            >
              <div className="overflow-hidden rounded-lg border border-border">
              <StoryboardPageRow
                panelLoaded={{
                  images: imageClassificationResult?.data != null,
                  text: extraction?.data != null,
                  sections: sectioningResult?.data != null,
                }}
                webRenderingProps={{
                  label,
                  pageId: page.pageId,
                  pageNumber: i + 1,
                  sections: webRenderingResult?.sections ?? null,
                }}
              >
                {[
                  <ImageClassificationPanel
                    key="images"
                    label={label}
                    pageId={page.pageId}
                    pageIndex={i}
                    imageIds={page.imageIds}
                    initialClassification={imageClassificationResult?.data ?? null}
                    initialVersion={imageClassificationResult?.version ?? 1}
                    availableVersions={imageClassificationVersions}
                    initialImageHashes={imageHashes}
                  />,
                  <TextClassificationPanel
                    key="text"
                    label={label}
                    pageId={page.pageId}
                    initialData={extraction?.data ?? null}
                    initialVersion={extraction?.version ?? 1}
                    availableVersions={availableVersions}
                    textTypes={textTypeKeys}
                    groupTypes={groupTypeKeys}
                  />,
                  <SectionsPanel
                    key="sections"
                    label={label}
                    pageId={page.pageId}
                    initialSectioning={sectioningResult?.data ?? null}
                    initialVersion={sectioningResult?.version ?? 1}
                    availableVersions={sectioningVersions}
                    extraction={extraction?.data ?? null}
                    imageIds={page.imageIds}
                    sectionTypes={sectionTypes}
                    textTypes={textTypeKeys}
                    groupTypes={groupTypeKeys}
                  />,
                ]}
              </StoryboardPageRow>
              </div>
            </section>
          );
        })}
      </div>
    </div>
    </PipelineSSEProvider>
  );
}
