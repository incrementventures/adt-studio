"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BookSummary } from "@/lib/books";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function BookGrid({ books }: { books: BookSummary[] }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [label, setLabel] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [extractPage, setExtractPage] = useState(0);
  const [extractTotal, setExtractTotal] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function openDialog() {
    setUploading(false);
    setProgress("");
    setLabel("");
    setFileName("");
    setDragging(false);
    setExtractPage(0);
    setExtractTotal(0);
    if (fileRef.current) fileRef.current.value = "";
    dialogRef.current?.showModal();
  }

  function acceptFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) return;
    // Put the file into the hidden input via DataTransfer
    const dt = new DataTransfer();
    dt.items.add(file);
    if (fileRef.current) fileRef.current.files = dt.files;
    setFileName(file.name);
    if (!label) setLabel(slugify(file.name));
  }

  function onFileChange() {
    const file = fileRef.current?.files?.[0];
    if (file) acceptFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !label) return;

    setUploading(true);
    setProgress("Uploading…");
    setExtractPage(0);
    setExtractTotal(0);

    const form = new FormData();
    form.append("pdf", file);
    form.append("label", label);

    try {
      const res = await fetch("/api/books/upload", {
        method: "POST",
        body: form,
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setProgress(body?.error ?? "Upload failed.");
        setUploading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop()!;

        for (const line of lines) {
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.done) {
            dialogRef.current?.close();
            router.push(`/books/${msg.label}`);
            return;
          }
          if (msg.error) {
            setProgress(`Error: ${msg.error}`);
            setUploading(false);
            return;
          }
          setExtractPage(msg.page);
          setExtractTotal(msg.totalPages);
          setProgress(`Extracting page ${msg.page} of ${msg.totalPages}…`);
        }
      }
    } catch (err) {
      setProgress(`Error: ${err}`);
      setUploading(false);
    }
  }

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
  const labelValid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(label);
  const labelTaken = existingLabels.has(label);
  const pct = extractTotal > 0 ? Math.round((extractPage / extractTotal) * 100) : 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Books</h1>
        <button
          onClick={openDialog}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-lg font-semibold text-background transition-opacity hover:opacity-90"
          title="Upload PDF"
        >
          +
        </button>
      </div>

      {books.length === 0 ? (
        <p className="text-muted">
          No books found. Click + to upload a PDF.
        </p>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {books.map((book) => (
            <div
              key={book.label}
              className="group relative overflow-hidden rounded-lg border border-border transition-colors hover:border-border-hover"
              onMouseLeave={() => {
                if (confirmDelete === book.label) setConfirmDelete(null);
              }}
            >
              <Link href={`/books/${book.label}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/books/${book.label}/cover`}
                  alt={book.metadata.title ?? book.label}
                  className="aspect-[3/4] w-full object-cover bg-surface"
                />
                <div className="p-2">
                  <h2 className="text-sm font-semibold text-foreground group-hover:underline truncate">
                    {book.metadata.title ?? book.label}
                  </h2>
                  {book.metadata.authors.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted truncate">
                      {book.metadata.authors.join(", ")}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-faint">
                    {book.pageCount} pages
                  </p>
                </div>
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
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-background shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm open:flex"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current.close();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-foreground px-6 py-2.5">
          <h2 className="text-sm font-semibold text-background">
            Add Book
          </h2>
          <button
            onClick={() => dialogRef.current?.close()}
            disabled={uploading}
            className="-mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-background/50 transition-colors hover:bg-background/10 hover:text-background disabled:opacity-50"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.78 4.28a.75.75 0 0 0-1.06-1.06L7.5 6.44 4.28 3.22a.75.75 0 0 0-1.06 1.06L6.44 7.5 3.22 10.72a.75.75 0 1 0 1.06 1.06L7.5 8.56l3.22 3.22a.75.75 0 1 0 1.06-1.06L8.56 7.5l3.22-3.22Z" fill="currentColor"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="border-t border-border px-6 py-5">
          {/* Drop zone */}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            disabled={uploading}
            onChange={onFileChange}
            className="hidden"
          />
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !uploading && fileRef.current?.click()}
            className={[
              "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors",
              dragging
                ? "border-foreground/30 bg-surface"
                : fileName
                  ? "border-border bg-surface/60"
                  : "border-border hover:border-border-hover hover:bg-surface/40",
              uploading ? "pointer-events-none opacity-60" : "",
            ].join(" ")}
          >
            {fileName ? (
              <>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/8 text-foreground">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.414A2 2 0 0 0 15.414 6L12 2.586A2 2 0 0 0 10.586 2H6Z" fill="currentColor" opacity="0.2"/>
                    <path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.414a2 2 0 0 0-.586-1.414L12 2.586A2 2 0 0 0 10.586 2H6Zm0 1.5h4V6a2 2 0 0 0 2 2h2.5v8a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" fill="currentColor"/>
                  </svg>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{fileName}</p>
                <p className="mt-0.5 text-xs text-faint">Click or drop to replace</p>
              </>
            ) : (
              <>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-bright text-faint">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 3a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5v-5.5A.75.75 0 0 1 10 3Z" fill="currentColor"/>
                  </svg>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  Drop a PDF here, or click to browse
                </p>
                <p className="mt-0.5 text-xs text-faint">PDF files only</p>
              </>
            )}
          </div>

          {/* Label field */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <label htmlFor="book-label" className="block text-xs font-medium text-muted">
                Label
              </label>
              {label && !labelValid && (
                <span className="text-xs text-red-500">
                  Use lowercase letters, numbers, and hyphens
                </span>
              )}
              {label && labelValid && labelTaken && (
                <span className="text-xs text-red-500">
                  A book with this label already exists
                </span>
              )}
            </div>
            <input
              id="book-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              disabled={uploading}
              placeholder="e.g. my-book"
              className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-faint transition-colors focus:border-border-hover focus:outline-none focus:ring-1 focus:ring-border-hover disabled:opacity-50"
            />
          </div>

          {/* Progress */}
          {uploading && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{progress}</span>
                {extractTotal > 0 && (
                  <span className="tabular-nums text-muted">{pct}%</span>
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-bright">
                <div
                  className="h-full rounded-full bg-foreground transition-all duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Error (non-uploading) */}
          {!uploading && progress && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm text-red-600">{progress}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 border-t border-border bg-surface/50 px-6 py-2.5">
          <button
            onClick={() => dialogRef.current?.close()}
            disabled={uploading}
            className="rounded-lg border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-surface active:bg-surface-bright disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !labelValid || labelTaken || !fileName}
            className="rounded-lg bg-foreground px-3.5 py-1.5 text-sm font-medium text-background shadow-sm transition-colors hover:bg-foreground/85 active:bg-foreground/70 disabled:opacity-50"
          >
            {uploading ? "Extracting…" : "Upload"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
