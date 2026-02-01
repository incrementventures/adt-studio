"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookMetadata } from "@/lib/pipeline/metadata/metadata-schema";
import type { PdfMetadata } from "@/lib/pipeline/extract/extract";

const STUB_REASONING = "Auto-generated stub from PDF upload";

const PDF_METADATA_LABELS: Record<string, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
  producer: "Producer",
  creationDate: "Created",
  modificationDate: "Modified",
  format: "Format",
  encryption: "Encryption",
};

interface MetadataPanelProps {
  label: string;
  metadata: BookMetadata;
  pdfMetadata: PdfMetadata | null;
}

type ExtractionStatus = "idle" | "extracting" | "done" | "error";

export default function MetadataPanel({
  label,
  metadata: initialMetadata,
  pdfMetadata,
}: MetadataPanelProps) {
  const [metadata, setMetadata] = useState(initialMetadata);
  const [status, setStatus] = useState<ExtractionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const isStub = metadata.reasoning === STUB_REASONING;

  const runExtraction = useCallback(async () => {
    setStatus("extracting");
    setError(null);

    try {
      const res = await fetch(`/api/books/${label}/metadata`, {
        method: "POST",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Extraction failed (${res.status})`);
        setStatus("error");
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";

      // Non-streaming response (already_complete)
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.metadata) setMetadata(data.metadata);
        setStatus("done");
        return;
      }

      // NDJSON streaming response
      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        setStatus("error");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let errored = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.error) {
              setError(msg.error);
              setStatus("error");
              errored = true;
              return;
            }
            if (msg.done && msg.metadata) {
              setMetadata(msg.metadata);
              setStatus("done");
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      if (!errored) setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [label]);

  // Auto-trigger extraction when metadata is a stub
  useEffect(() => {
    if (initialMetadata.reasoning === STUB_REASONING) {
      runExtraction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = status === "extracting";

  // Collect non-empty PDF metadata entries
  const pdfEntries = pdfMetadata
    ? (Object.entries(pdfMetadata) as [string, string | undefined][]).filter(
        ([, v]) => v
      )
    : [];

  return (
    <div className="mb-8 overflow-hidden rounded-lg border border-border">
      {/* Header bar */}
      <div className="flex items-center gap-2 bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
        <span>Metadata</span>
        {error && (
          <span className="text-xs font-normal text-red-200">{error}</span>
        )}
        <button
          type="button"
          onClick={runExtraction}
          disabled={loading}
          className="ml-auto cursor-pointer rounded p-1 text-white/80 hover:text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
          title={loading ? "Extracting…" : "Rerun metadata extraction"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.434l.311.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.311H11.768a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.53a.75.75 0 00-1.5 0v2.434l-.311-.312A7 7 0 002.629 8.79a.75.75 0 001.449.39z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* PDF embedded metadata */}
        {pdfEntries.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
              PDF Metadata
            </h3>
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {pdfEntries.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-muted">
                    {PDF_METADATA_LABELS[key] ?? key}
                  </dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* LLM-extracted metadata — hidden entirely while first extraction is in progress */}
        {!(isStub && loading) && !isStub && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
              Extracted Metadata
            </h3>
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {metadata.title && (
                <div>
                  <dt className="text-muted">Title</dt>
                  <dd>{metadata.title}</dd>
                </div>
              )}
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
            </dl>
            {metadata.table_of_contents &&
              metadata.table_of_contents.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-muted">
                    Table of Contents
                  </h4>
                  <ul className="mt-1 text-sm">
                    {metadata.table_of_contents.map((entry, i) => (
                      <li key={i} className="flex justify-between py-0.5">
                        <span>{entry.title}</span>
                        <span className="text-faint">
                          p. {entry.page_number}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
