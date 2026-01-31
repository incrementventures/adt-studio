import Link from "next/link";
import {
  listPages,
  getTextClassification,
  listTextClassificationVersions,
} from "@/lib/books";
import { textTypeKeys, groupTypeKeys } from "@/lib/config";
import { LightboxImage } from "./image-lightbox";
import { TextClassificationPanel } from "./text-classification-panel";

export default async function ExtractPage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const pages = listPages(label);

  return (
    <div>
      <div className="space-y-8">
        {pages.map((page, i) => {
          const extraction = getTextClassification(label, page.pageId);
          const availableVersions = listTextClassificationVersions(label, page.pageId);
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

              {/* Top: page image + raw text side by side */}
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
                <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 font-mono text-xs text-foreground">
                  {page.rawText || <span className="text-faint italic">No raw text</span>}
                </pre>
              </div>

              {/* Bottom: text classification */}
              <TextClassificationPanel
                label={label}
                pageId={page.pageId}
                initialData={extraction?.data ?? null}
                initialVersion={extraction?.version ?? 1}
                availableVersions={availableVersions}
                textTypes={textTypeKeys}
                groupTypes={groupTypeKeys}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
