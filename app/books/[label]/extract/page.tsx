import { listPages, getImageHashes } from "@/lib/books";
import { LightboxImage } from "./image-lightbox";

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
          const hashes = getImageHashes(label, page.pageId);
          const pageHash = hashes[`${page.pageId}_page`];
          const pageQs = pageHash ? `?h=${pageHash}` : "";
          const extractedIds = page.imageIds.filter((id) => !id.endsWith("_page"));
          return (
            <section
              key={page.pageId}
              id={page.pageId}
              className="scroll-mt-16 overflow-hidden rounded-lg border border-border"
            >
              <div className="bg-slate-600 px-4 py-2.5 text-sm font-semibold text-white">
                Page {i + 1}
              </div>

              <div className="grid gap-6 p-4 lg:grid-cols-[280px_1fr]">
                <LightboxImage
                  src={`/api/books/${label}/pages/${page.pageId}/image${pageQs}`}
                  alt={`Page ${i + 1}`}
                  className="w-full rounded-lg border border-border"
                />
                <pre className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 font-mono text-xs text-foreground">
                  {page.rawText || <span className="text-faint italic">No raw text</span>}
                </pre>
              </div>
              {extractedIds.length > 0 && (
                <div className="grid grid-cols-6 gap-2 px-4 pb-4">
                  {extractedIds.map((imageId) => {
                    const h = hashes[imageId];
                    const qs = h ? `?h=${h}` : "";
                    return (
                      <LightboxImage
                        key={imageId}
                        src={`/api/books/${label}/pages/${page.pageId}/images/${imageId}${qs}`}
                        alt={imageId}
                        className="rounded-t border border-border"
                        showDimensions
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
