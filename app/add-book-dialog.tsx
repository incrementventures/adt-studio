"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { dialogStyles } from "./ui/dialog-styles";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function AddBookDialog({
  existingLabels,
  autoOpen = false,
}: {
  existingLabels: Set<string>;
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [label, setLabel] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [startPage, setStartPage] = useState("");
  const [endPage, setEndPage] = useState("");
  const [extractPage, setExtractPage] = useState(0);
  const [extractTotal, setExtractTotal] = useState(0);

  function open() {
    setUploading(false);
    setProgress("");
    setLabel("");
    setFileName("");
    setStartPage("");
    setEndPage("");
    setDragging(false);
    setExtractPage(0);
    setExtractTotal(0);
    if (fileRef.current) fileRef.current.value = "";
    dialogRef.current?.showModal();
  }

  // Auto-open dialog when autoOpen prop is true
  useEffect(() => {
    if (autoOpen) {
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function acceptFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) return;
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
    setProgress("Uploading\u2026");
    setExtractPage(0);
    setExtractTotal(0);

    const form = new FormData();
    form.append("pdf", file);
    form.append("label", label);
    if (startPage) form.append("start_page", startPage);
    if (endPage) form.append("end_page", endPage);

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
          setProgress(`Extracting page ${msg.page} of ${msg.totalPages}\u2026`);
        }
      }
    } catch (err) {
      setProgress(`Error: ${err}`);
      setUploading(false);
    }
  }

  const labelValid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(label);
  const labelTaken = existingLabels.has(label);
  const pageRangeInvalid =
    startPage !== "" &&
    endPage !== "" &&
    parseInt(startPage, 10) > parseInt(endPage, 10);
  const pct = extractTotal > 0 ? Math.round((extractPage / extractTotal) * 100) : 0;

  return (
    <>
      <button
        onClick={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-lg font-semibold text-background transition-opacity hover:opacity-90"
        title="Upload PDF"
      >
        +
      </button>

      <dialog
        ref={dialogRef}
        className={dialogStyles.dialog}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current.close();
        }}
      >
        {/* Header */}
        <div className={dialogStyles.header}>
          <h2 className={dialogStyles.headerTitle}>
            Add Book
          </h2>
          <button
            onClick={() => dialogRef.current?.close()}
            disabled={uploading}
            className={dialogStyles.headerClose}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.78 4.28a.75.75 0 0 0-1.06-1.06L7.5 6.44 4.28 3.22a.75.75 0 0 0-1.06 1.06L6.44 7.5 3.22 10.72a.75.75 0 1 0 1.06 1.06L7.5 8.56l3.22 3.22a.75.75 0 1 0 1.06-1.06L8.56 7.5l3.22-3.22Z" fill="currentColor"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className={dialogStyles.body}>
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

          {/* Page range */}
          <div className="mt-4 flex gap-3">
            <div className="flex-1">
              <label htmlFor="start-page" className="block text-xs font-medium text-muted">
                Start Page
              </label>
              <input
                id="start-page"
                type="number"
                min="1"
                value={startPage}
                onChange={(e) => setStartPage(e.target.value.replace(/[^0-9]/g, ""))}
                disabled={uploading}
                placeholder="Optional"
                className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-faint transition-colors focus:border-border-hover focus:outline-none focus:ring-1 focus:ring-border-hover disabled:opacity-50"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="end-page" className="block text-xs font-medium text-muted">
                End Page
              </label>
              <input
                id="end-page"
                type="number"
                min="1"
                value={endPage}
                onChange={(e) => setEndPage(e.target.value.replace(/[^0-9]/g, ""))}
                disabled={uploading}
                placeholder="Optional"
                className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-faint transition-colors focus:border-border-hover focus:outline-none focus:ring-1 focus:ring-border-hover disabled:opacity-50"
              />
            </div>
          </div>
          {pageRangeInvalid && (
            <p className="mt-1.5 text-xs text-red-500">
              Start page must be less than or equal to end page
            </p>
          )}

          {/* Progress/Error area - always rendered to prevent layout shift */}
          <div className="mt-5">
            {!uploading && progress ? (
              /* Error state */
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-sm text-red-600">{progress}</p>
              </div>
            ) : (
              /* Progress state (visible when uploading, invisible otherwise) */
              <div className={uploading ? "" : "invisible"}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{progress || "\u00A0"}</span>
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
          </div>
        </div>

        {/* Footer */}
        <div className={dialogStyles.footer}>
          <button
            onClick={() => dialogRef.current?.close()}
            disabled={uploading}
            className={dialogStyles.cancelBtn}
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !labelValid || labelTaken || !fileName || pageRangeInvalid}
            className={dialogStyles.primaryBtn}
          >
            {uploading ? "Extracting\u2026" : "Upload"}
          </button>
        </div>
      </dialog>
    </>
  );
}
