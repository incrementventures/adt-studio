"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dialogStyles } from "@/app/ui/dialog-styles";

export function SchemaErrorPage({ label }: { label: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [extractPage, setExtractPage] = useState(0);
  const [extractTotal, setExtractTotal] = useState(0);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/books/${label}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
    } else {
      setDeleting(false);
    }
  }

  async function handleReimport() {
    setReimporting(true);
    setProgress("Starting reimport\u2026");
    setExtractPage(0);
    setExtractTotal(0);
    try {
      const res = await fetch(`/api/books/${label}/reimport`, {
        method: "POST",
      });
      if (!res.ok || !res.body) {
        setProgress("Reimport failed.");
        setReimporting(false);
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
            window.location.href = `/books/${label}`;
            return;
          }
          if (msg.error) {
            setProgress(`Error: ${msg.error}`);
            setReimporting(false);
            return;
          }
          setExtractPage(msg.page);
          setExtractTotal(msg.totalPages);
          setProgress(`Extracting page ${msg.page} of ${msg.totalPages}\u2026`);
        }
      }
    } catch (err) {
      setProgress(`Error: ${err}`);
      setReimporting(false);
    }
  }

  const busy = deleting || reimporting;
  const pct =
    extractTotal > 0 ? Math.round((extractPage / extractTotal) * 100) : 0;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <dialog ref={dialogRef} className={dialogStyles.dialog}>
        {/* Header */}
        <div className={dialogStyles.header}>
          <h2 className={dialogStyles.headerTitle}>
            Incompatible database
          </h2>
          <button
            onClick={() => router.push("/")}
            disabled={busy}
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
          <p className="text-sm text-muted">
            The database for{" "}
            <span className="font-medium text-foreground">{label}</span>{" "}
            was created with a different schema version and cannot be opened.
            You can reimport the book using the existing config, or delete it
            entirely.
          </p>

          {/* Progress */}
          {reimporting && (
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

          {/* Error (non-busy) */}
          {!busy && progress && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm text-red-600">{progress}</p>
            </div>
          )}

          {/* Delete confirmation */}
          {confirmDelete && !busy && (
            <p className="mt-4 text-sm text-red-600">
              This will permanently delete all data for this book. Are you sure?
            </p>
          )}
        </div>

        {/* Footer */}
        <div className={dialogStyles.footer}>
          {!confirmDelete ? (
            <>
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className={dialogStyles.secondaryBtn + " text-red-600 hover:text-red-700 hover:bg-red-50"}
              >
                Delete book
              </button>
              <button
                onClick={() => router.push("/")}
                disabled={busy}
                className={dialogStyles.cancelBtn}
              >
                Back
              </button>
              <button
                onClick={handleReimport}
                disabled={busy}
                className={dialogStyles.primaryBtn}
              >
                {reimporting ? "Extracting\u2026" : "Reimport"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className={dialogStyles.cancelBtn}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 active:bg-red-800 disabled:opacity-50"
              >
                {deleting ? "Deleting\u2026" : "Confirm delete"}
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
