"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageTextExtraction } from "@/lib/books";
import { TextTypeBadge } from "./text-type-badge";

interface TextExtractionPanelProps {
  label: string;
  pageId: string;
  initialData: PageTextExtraction;
  initialVersion: number;
  availableVersions: number[];
  textTypes: string[];
  groupTypes: string[];
}

export function TextExtractionPanel({
  label,
  pageId,
  initialData,
  initialVersion,
  availableVersions: initialAvailableVersions,
  textTypes,
  groupTypes,
}: TextExtractionPanelProps) {
  const [data, setData] = useState(initialData);
  const [version, setVersion] = useState(initialVersion);
  const [versions, setVersions] = useState(initialAvailableVersions);
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);

  const versionLabel = version === 1 ? "original" : `v${version}`;

  // Close version dropdown on outside click / escape
  useEffect(() => {
    if (!versionDropdownOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVersionDropdownOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (
        versionDropdownRef.current &&
        !versionDropdownRef.current.contains(e.target as Node)
      ) {
        setVersionDropdownOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [versionDropdownOpen]);

  async function loadVersion(v: number) {
    setVersionDropdownOpen(false);
    if (v === version) return;
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/text-extraction`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: v }),
        }
      );
      if (!res.ok) return;
      const json = await res.json();
      setData(json.data as PageTextExtraction);
      setVersion(v);
    } catch {
      // ignore
    }
  }

  async function patchExtraction(
    body: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/books/${label}/pages/${pageId}/text-extraction`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, baseVersion: version }),
        }
      );
      if (!res.ok) return false;
      const json = await res.json();
      const { version: newVersion, ...rest } = json;
      setVersion(newVersion);
      setData(rest as PageTextExtraction);
      setVersions((prev) =>
        prev.includes(newVersion) ? prev : [...prev, newVersion].sort((a, b) => a - b)
      );
      return true;
    } catch {
      return false;
    }
  }

  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
        <span>Text Extraction</span>
        <div ref={versionDropdownRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setVersionDropdownOpen(!versionDropdownOpen)}
            className="cursor-pointer rounded bg-indigo-500 px-1.5 py-0.5 text-xs font-medium hover:bg-indigo-400 transition-colors"
          >
            {versionLabel} ▾
          </button>
          {versionDropdownOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-36 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
              {versions.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => loadVersion(v)}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface ${v === version ? "font-semibold bg-surface" : ""}`}
                >
                  {v === 1 ? "original" : `v${v}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-3 p-4">
        {data.groups.map((group, gi) => (
          <div key={gi} className="rounded-lg border border-border p-3">
            <GroupTypeLabel
              currentType={group.group_type}
              groupTypes={groupTypes}
              onSelect={(newType) =>
                patchExtraction({ groupIndex: gi, groupType: newType })
              }
            />
            <div className="space-y-1.5">
              {group.texts.map((entry, ti) => (
                <div
                  key={ti}
                  className="flex items-start justify-between gap-3"
                >
                  <EditableText
                    text={entry.text}
                    onSave={(newText) =>
                      patchExtraction({
                        groupIndex: gi,
                        textIndex: ti,
                        text: newText,
                      })
                    }
                  />
                  <TextTypeBadge
                    label={label}
                    pageId={pageId}
                    groupIndex={gi}
                    textIndex={ti}
                    currentType={entry.text_type}
                    textTypes={textTypes}
                    onTypeChange={(newType) =>
                      patchExtraction({
                        groupIndex: gi,
                        textIndex: ti,
                        textType: newType,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── GroupTypeLabel ──────────────────────────────────────────────── */

function GroupTypeLabel({
  currentType,
  groupTypes,
  onSelect,
}: {
  currentType: string;
  groupTypes: string[];
  onSelect: (newType: string) => Promise<boolean>;
}) {
  const [type, setType] = useState(currentType);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const ok = await onSelect(newType);
    if (!ok) setType(prev);
  }

  return (
    <div ref={containerRef} className="relative mb-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="cursor-pointer text-xs font-medium uppercase tracking-wider text-faint hover:text-foreground"
      >
        {type}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {groupTypes.map((t) => (
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

/* ── EditableText ───────────────────────────────────────────────── */

function EditableText({
  text,
  onSave,
}: {
  text: string;
  onSave: (newText: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync if parent data updates
  useEffect(() => {
    if (!editing) setValue(text);
  }, [text, editing]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  async function save() {
    setEditing(false);
    if (value === text) return;
    const ok = await onSave(value);
    if (!ok) setValue(text);
  }

  function cancel() {
    setValue(text);
    setEditing(false);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        className="flex-1 resize-none rounded border border-border bg-surface p-1 font-mono text-xs whitespace-pre-wrap focus:outline-none focus:ring-1 focus:ring-indigo-500"
        rows={Math.max(1, value.split("\n").length)}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="flex-1 cursor-pointer rounded px-1 py-0.5 font-mono text-xs whitespace-pre-wrap hover:bg-surface"
    >
      {value}
    </span>
  );
}
