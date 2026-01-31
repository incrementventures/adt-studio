import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookMetadata, listPages } from "@/lib/books";


export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const metadata = getBookMetadata(label);
  if (!metadata) notFound();

  const pages = listPages(label);

  return (
    <div>
      <div className="mb-8 rounded-lg border border-border p-6">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {metadata.authors.length > 0 && (
            <div>
              <dt className="text-muted">Authors</dt>
              <dd>{metadata.authors.join(", ")}</dd>
            </div>
          )}
          {metadata.publisher && (
            <div>
              <dt className="text-muted">Publisher</dt>
              <dd>{metadata.publisher}</dd>
            </div>
          )}
          {metadata.language_code && (
            <div>
              <dt className="text-muted">Language</dt>
              <dd>{metadata.language_code}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted">Pages</dt>
            <dd>{pages.length}</dd>
          </div>
        </dl>
        {metadata.table_of_contents && metadata.table_of_contents.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-muted">
              Table of Contents
            </h3>
            <ul className="mt-1 text-sm">
              {metadata.table_of_contents.map((entry, i) => (
                <li key={i} className="flex justify-between py-0.5">
                  <span>{entry.title}</span>
                  <span className="text-faint">p. {entry.page_number}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h2 className="mb-4 text-lg font-semibold">Pages</h2>
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {pages.map((page) => (
          <Link
            key={page.pageId}
            href={`/books/${label}/pages/${page.pageId}`}
            className="group overflow-hidden rounded-lg border border-border transition-colors hover:border-border-hover"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/books/${label}/pages/${page.pageId}/image`}
              alt={page.pageId}
              className="aspect-[3/4] w-full object-cover bg-surface"
            />
            <div className="p-2 text-center text-xs text-muted group-hover:text-foreground">
              {page.pageId}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
