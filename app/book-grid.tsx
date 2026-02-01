"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BookSummary } from "@/lib/books";
import AddBookDialog from "./add-book-dialog";

export default function BookGrid({ books }: { books: BookSummary[] }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(bookLabel: string) {
    if (confirmDelete !== bookLabel) {
      setConfirmDelete(bookLabel);
      return;
    }
    setDeleting(bookLabel);
    try {
      const res = await fetch(`/api/books/${bookLabel}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleting(null);
        setConfirmDelete(null);
        return;
      }
      router.refresh();
    } catch {
      setDeleting(null);
      setConfirmDelete(null);
    }
  }

  const existingLabels = new Set(books.map((b) => b.label));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Books</h1>
        <AddBookDialog existingLabels={existingLabels} />
      </div>

      {books.length === 0 ? (
        <p className="text-muted">
          No books found. Click + to upload a PDF.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {books.map((book) => {
            const details = [
              book.metadata.publisher,
              book.metadata.language_code,
              book.pageCount ? `${book.pageCount} pages` : null,
            ].filter(Boolean);

            return (
              <div
                key={book.label}
                className="group relative overflow-hidden rounded-lg border border-border transition-colors hover:border-border-hover"
                onMouseLeave={() => {
                  if (confirmDelete === book.label) setConfirmDelete(null);
                }}
              >
                <Link href={`/books/${book.label}`} className="flex">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/books/${book.label}/cover`}
                    alt={book.metadata.title ?? book.label}
                    className="h-28 object-cover bg-surface rounded-l-lg shrink-0"
                  />
                  <div className="flex-1 p-4 flex flex-col justify-center min-w-0">
                    <h2 className="text-base font-semibold text-foreground truncate">
                      {book.metadata.title ?? book.label}
                    </h2>
                    {book.metadata.authors.length > 0 && (
                      <p className="mt-0.5 text-sm text-muted truncate">
                        {book.metadata.authors.join(", ")}
                      </p>
                    )}
                    {details.length > 0 && (
                      <p className="mt-0.5 text-xs text-faint truncate">
                        {details.join(" · ")}
                      </p>
                    )}
                  </div>
                  <span className="absolute bottom-2 right-2 text-xs text-muted font-mono">
                    {book.label}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete(book.label);
                  }}
                  disabled={deleting === book.label}
                  className={[
                    "absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md transition-all",
                    confirmDelete === book.label
                      ? "bg-red-600 text-white opacity-100 hover:bg-red-500"
                      : "bg-black/50 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/70 hover:text-white",
                    deleting === book.label ? "opacity-50" : "",
                  ].join(" ")}
                  title={confirmDelete === book.label ? "Click again to confirm" : "Delete book"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
