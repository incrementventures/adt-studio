import { notFound } from "next/navigation";
import { getBookMetadata, getPdfMetadata, listPages } from "@/lib/books";
import MetadataPanel from "./metadata-panel";
import { LightboxImage } from "./extract/image-lightbox";


export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const metadata = getBookMetadata(label);
  if (!metadata) notFound();

  const pdfMetadata = getPdfMetadata(label);
  const pages = listPages(label);

  return (
    <div>
      <MetadataPanel label={label} metadata={metadata} pdfMetadata={pdfMetadata} />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {pages.map((page) => (
          <div
            key={page.pageId}
            className="overflow-hidden rounded-lg border border-border"
          >
            <LightboxImage
              src={`/api/books/${label}/pages/${page.pageId}/image`}
              alt={page.pageId}
              className="w-full bg-surface"
            />
            <div className="p-2 text-center text-xs text-muted">
              {page.pageId}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
