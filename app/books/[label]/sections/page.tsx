import Link from "next/link";
import {
  listPages,
  getPageSectioning,
  getTextExtraction,
} from "@/lib/books";
import { getSectionTypes } from "@/lib/config";
import { LightboxImage } from "../extract/image-lightbox";
import { SectionsPanel } from "./sections-panel";

export default async function SectionsPage({
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
          const sectioning = getPageSectioning(label, page.pageId);
          const extraction = getTextExtraction(label, page.pageId);
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

              <div className="grid gap-6 p-4 lg:grid-cols-[280px_1fr]">
                <div className="space-y-3">
                  <LightboxImage
                    src={`/api/books/${label}/pages/${page.pageId}/image`}
                    alt={`Page ${i + 1}`}
                    className="w-full rounded-lg border border-border"
                  />
                  {page.imageIds.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {page.imageIds.map((imageId) => (
                        <LightboxImage
                          key={imageId}
                          src={`/api/books/${label}/pages/${page.pageId}/images/${imageId}`}
                          alt={imageId}
                          className="rounded border border-border"
                        />
                      ))}
                    </div>
                  )}
                </div>

                <SectionsPanel
                  label={label}
                  pageId={page.pageId}
                  sectioning={sectioning}
                  extraction={extraction?.data ?? null}
                  imageIds={page.imageIds}
                  sectionTypes={sectionTypes}
                />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
