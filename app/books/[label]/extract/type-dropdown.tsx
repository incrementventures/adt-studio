"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function TypeDropdown({
  currentType,
  types,
  onSelect,
  className,
}: {
  currentType: string;
  types: string[];
  onSelect: (newType: string) => void;
  className?: string;
}) {
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

  function handleSelect(newType: string) {
    if (newType === type) {
      close();
      return;
    }
    setType(newType);
    close();
    onSelect(newType);
  }

  return (
    <div ref={containerRef} className={className ?? "relative mb-1.5"}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="cursor-pointer text-xs font-medium uppercase tracking-wider text-faint hover:text-foreground"
      >
        {type}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleSelect(t)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface ${t === type ? "font-semibold" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
