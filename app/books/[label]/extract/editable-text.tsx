"use client";

import { useEffect, useRef, useState } from "react";

export function EditableText({
  text,
  onSave,
}: {
  text: string;
  onSave: (newText: string) => void;
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

  function save() {
    setEditing(false);
    if (value === text) return;
    onSave(value);
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
      className="min-w-0 flex-1 cursor-pointer rounded px-1 py-0.5 font-mono text-xs whitespace-pre-wrap hover:bg-surface"
    >
      {value}
    </span>
  );
}
