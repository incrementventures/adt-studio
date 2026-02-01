"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function LightboxImage({
  src,
  alt,
  className,
  showDimensions,
}: {
  src: string;
  alt: string;
  className?: string;
  showDimensions?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Catch images that loaded before hydration
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, []);

  const imgEl = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={`cursor-pointer ${className ?? ""}`}
      onClick={() => setOpen(true)}
      onLoad={(e) => {
        const img = e.currentTarget;
        setDims({ w: img.naturalWidth, h: img.naturalHeight });
      }}
    />
  );

  return (
    <>
      {showDimensions ? (
        <div>
          {imgEl}
          {dims && (
            <div className="flex items-center justify-between rounded-b border border-t-0 border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
              <span>{dims.w}&times;{dims.h}</span>
              <span>{alt}</span>
            </div>
          )}
        </div>
      ) : imgEl}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="max-h-[90vh] max-w-[90vw] rounded-lg border border-border shadow-2xl"
            />
            <button
              onClick={close}
              className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-background border border-border text-muted hover:text-foreground text-sm"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
}
