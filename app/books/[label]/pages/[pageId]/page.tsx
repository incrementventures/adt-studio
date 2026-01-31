import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookMetadata, getPage, getTextExtraction } from "@/lib/books";

const TEXT_TYPE_COLORS: Record<string, string> = {
  book_title: "bg-purple-100 text-purple-800",
  book_subtitle: "bg-purple-100 text-purple-800",
  book_author: "bg-indigo-100 text-indigo-800",
  book_metadata: "bg-indigo-100 text-indigo-800",
  section_heading: "bg-blue-100 text-blue-800",
  section_text: "bg-slate-100 text-slate-700",
  instruction_text: "bg-amber-100 text-amber-800",
  activity_number: "bg-green-100 text-green-800",
  activity_title: "bg-green-100 text-green-800",
  activity_option: "bg-green-100 text-green-800",
  activity_input_placeholder_text: "bg-green-100 text-green-800",
  fill_in_the_blank: "bg-green-100 text-green-800",
  image_associated_text: "bg-orange-100 text-orange-800",
  image_overlay: "bg-orange-100 text-orange-800",
  math: "bg-rose-100 text-rose-800",
  standalone_text: "bg-slate-100 text-slate-700",
  header_text: "bg-slate-100 text-slate-600",
  footer_text: "bg-slate-100 text-slate-600",
  page_number: "bg-slate-100 text-slate-600",
  other: "bg-slate-100 text-slate-600",
};

function badgeColor(textType: string): string {
  return TEXT_TYPE_COLORS[textType] ?? TEXT_TYPE_COLORS.other;
}

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ label: string; pageId: string }>;
}) {
  const { label, pageId } = await params;
  const metadata = getBookMetadata(label);
  if (!metadata) notFound();

  const page = getPage(label, pageId);
  if (!page) notFound();

  const extractionResult = getTextExtraction(label, pageId);
  const extraction = extractionResult?.data ?? null;

  return (
    <div>
      <nav className="mb-4 text-sm text-muted">
        <Link href="/" className="hover:text-foreground">
          Books
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/books/${label}`} className="hover:text-foreground">
          {metadata.title ?? label}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{pageId}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: images */}
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/books/${label}/pages/${pageId}/image`}
            alt={`${pageId} full page`}
            className="w-full rounded-lg border border-border"
          />
          {page.imageIds.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">
                Extracted Images
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {page.imageIds.map((imageId) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={imageId}
                    src={`/api/books/${label}/pages/${pageId}/images/${imageId}`}
                    alt={imageId}
                    className="rounded border border-border"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: text extraction */}
        <div className="space-y-4">
          {extraction ? (
            <>
              {extraction.groups.map((group, gi) => (
                <div
                  key={gi}
                  className="rounded-lg border border-border p-4"
                >
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
                    {group.group_type}
                  </div>
                  <div className="space-y-2">
                    {group.texts.map((entry, ti) => (
                      <div key={ti} className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor(entry.text_type)}`}
                        >
                          {entry.text_type}
                        </span>
                        <span className="font-mono text-sm whitespace-pre-wrap">
                          {entry.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {extraction.reasoning && (
                <details className="rounded-lg border border-border">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted hover:text-foreground">
                    LLM Reasoning
                  </summary>
                  <div className="border-t border-border px-4 py-3 text-sm whitespace-pre-wrap text-muted">
                    {extraction.reasoning}
                  </div>
                </details>
              )}
            </>
          ) : (
            <p className="text-muted">
              No text extraction available for this page.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
