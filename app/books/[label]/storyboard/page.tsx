import Link from "next/link";
import {
  listPages,
  getTextClassification,
  listTextClassificationVersions,
  getPageSectioning,
  getImageClassification,
  listImageClassificationVersions,
} from "@/lib/books";
import { textTypeKeys, groupTypeKeys, getSectionTypes } from "@/lib/config";
import { TextClassificationPanel } from "../extract/text-classification-panel";
import { ImageClassificationPanel } from "../extract/image-classification-panel";
import { SectionsPanel } from "../sections/sections-panel";

export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const pages = listPages(label);
  const sectionTypes = getSectionTypes();

  return (
    <div>
      <div className="space-y-8">
        {pages.map((page, i) => {
          const extraction = getTextClassification(label, page.pageId);
          const availableVersions = listTextClassificationVersions(label, page.pageId);
          const sectioning = getPageSectioning(label, page.pageId);
          const imageClassificationResult = getImageClassification(label, page.pageId);
          const imageClassificationVersions = listImageClassificationVersions(label, page.pageId);
          return (
            <section
              key={page.pageId}
              id={page.pageId}
              className="scroll-mt-16 overflow-hidden rounded-lg border border-border"
            >
              <Link
                href={`/books/${label}/pages/${page.pageId}`}
                className="block bg-slate-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-500 transition-colors"
              >
                Page {i + 1}
              </Link>

              {/* Image Classification */}
              <ImageClassificationPanel
                label={label}
                pageId={page.pageId}
                pageIndex={i}
                imageIds={page.imageIds}
                initialClassification={imageClassificationResult?.data ?? null}
                initialVersion={imageClassificationResult?.version ?? 1}
                availableVersions={imageClassificationVersions}
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
