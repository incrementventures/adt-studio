"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const TEXT_TYPE_COLORS: Record<string, string> = {
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

interface TextTypeBadgeProps {
  label: string;
  pageId: string;
  groupIndex: number;
  textIndex: number;
  currentType: string;
  textTypes: string[];
  onTypeChange?: (newType: string) => Promise<boolean>;
}

export function TextTypeBadge({
  label,
  pageId,
  groupIndex,
  textIndex,
  currentType,
  textTypes,
  onTypeChange,
}: TextTypeBadgeProps) {
  const [type, setType] = useState(currentType);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setType(currentType);
  }, [currentType]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, close]);

  async function handleSelect(newType: string) {
    if (newType === type) {
      close();
      return;
    }

    const prev = type;
    setType(newType);
    close();

    try {
      if (onTypeChange) {
        const ok = await onTypeChange(newType);
        if (!ok) setType(prev);
      } else {
        const res = await fetch(
          `/api/books/${label}/pages/${pageId}/text-classification`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupIndex, textIndex, textType: newType }),
          }
        );
        if (!res.ok) setType(prev);
      }
    } catch {
      setType(prev);
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`mt-0.5 cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor(type)}`}
      >
        {type}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {textTypes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleSelect(t)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface ${t === type ? "font-semibold" : ""}`}
            >
              <span
                className={`inline-block rounded px-1.5 py-0.5 font-medium ${badgeColor(t)}`}
              >
                {t}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
