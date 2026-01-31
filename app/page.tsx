import Link from "next/link";
import { listBooks } from "@/lib/books";

export default function Home() {
  const books = listBooks();

  if (books.length === 0) {
    return (
      <p className="text-muted">
        No books found. Run the extraction pipeline first.
      </p>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Books</h1>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {books.map((book) => (
          <Link
            key={book.label}
            href={`/books/${book.label}`}
            className="group overflow-hidden rounded-lg border border-border transition-colors hover:border-border-hover"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/books/${book.label}/cover`}
              alt={book.metadata.title ?? book.label}
              className="aspect-[3/4] w-full object-cover bg-surface"
            />
            <div className="p-4">
              <h2 className="font-semibold text-foreground group-hover:underline">
                {book.metadata.title ?? book.label}
              </h2>
              {book.metadata.authors.length > 0 && (
                <p className="mt-1 text-sm text-muted">
                  {book.metadata.authors.join(", ")}
                </p>
              )}
              <p className="mt-1 text-xs text-faint">
                {book.pageCount} pages
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
