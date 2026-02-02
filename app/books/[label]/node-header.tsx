"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Reusable header bar for pipeline node cards.
//
// Handles:
//  - Title label (left side)
//  - Version dropdown with load/save/discard
//  - Rerun button (spinning refresh icon)
//  - Optional right-side children (edit mode buttons, etc.)
// ---------------------------------------------------------------------------

export interface VersionApi {
  /** Fetch a specific version's data via GET. Returns the parsed JSON response. */
  loadVersion: (version: number) => Promise<unknown>;
  /** Create a new version via PUT. Returns `{ version, versions, data, ... }`. */
  saveVersion: (version: number) => Promise<{ version: number; versions: number[] }>;
}

export type NodeHeaderColor = "slate" | "amber" | "blue" | "emerald" | "purple" | "rose" | "indigo" | "teal";

const colorMap: Record<NodeHeaderColor, {
  bg: string;
  btnBg: string;
  btnHover: string;
  rerunHover: string;
  dropdownBg: string;
  dropdownItemHover: string;
  saveText: string;
}> = {
  slate: {
    bg: "bg-slate-700",
    btnBg: "bg-slate-500",
    btnHover: "hover:bg-slate-400",
    rerunHover: "hover:bg-slate-600",
    dropdownBg: "bg-slate-600",
    dropdownItemHover: "hover:bg-slate-500",
    saveText: "text-slate-700",
  },
  amber: {
    bg: "bg-amber-600",
    btnBg: "bg-amber-500",
    btnHover: "hover:bg-amber-400",
    rerunHover: "hover:bg-amber-500",
    dropdownBg: "bg-amber-500",
    dropdownItemHover: "hover:bg-amber-400",
    saveText: "text-amber-700",
  },
  blue: {
    bg: "bg-blue-700",
    btnBg: "bg-blue-500",
    btnHover: "hover:bg-blue-400",
    rerunHover: "hover:bg-blue-600",
    dropdownBg: "bg-blue-600",
    dropdownItemHover: "hover:bg-blue-500",
    saveText: "text-blue-700",
  },
  emerald: {
    bg: "bg-emerald-700",
    btnBg: "bg-emerald-500",
    btnHover: "hover:bg-emerald-400",
    rerunHover: "hover:bg-emerald-600",
    dropdownBg: "bg-emerald-600",
    dropdownItemHover: "hover:bg-emerald-500",
    saveText: "text-emerald-700",
  },
  purple: {
    bg: "bg-purple-700",
    btnBg: "bg-purple-500",
    btnHover: "hover:bg-purple-400",
    rerunHover: "hover:bg-purple-600",
    dropdownBg: "bg-purple-600",
    dropdownItemHover: "hover:bg-purple-500",
    saveText: "text-purple-700",
  },
  rose: {
    bg: "bg-rose-700",
    btnBg: "bg-rose-500",
    btnHover: "hover:bg-rose-400",
    rerunHover: "hover:bg-rose-600",
    dropdownBg: "bg-rose-600",
    dropdownItemHover: "hover:bg-rose-500",
    saveText: "text-rose-700",
  },
  indigo: {
    bg: "bg-indigo-600",
    btnBg: "bg-indigo-500",
    btnHover: "hover:bg-indigo-400",
    rerunHover: "hover:bg-indigo-500",
    dropdownBg: "bg-indigo-500",
    dropdownItemHover: "hover:bg-indigo-400",
    saveText: "text-indigo-700",
  },
  teal: {
    bg: "bg-teal-600",
    btnBg: "bg-teal-500",
    btnHover: "hover:bg-teal-400",
    rerunHover: "hover:bg-teal-500",
    dropdownBg: "bg-teal-500",
    dropdownItemHover: "hover:bg-teal-400",
    saveText: "text-teal-700",
  },
};

export interface NodeHeaderProps {
  /** Display label shown on the left (e.g. section type). */
  title: string;
  /** Color theme for the header. Defaults to "slate". */
  color?: NodeHeaderColor;
  /** Current version (from parent). */
  initialVersion: number;
  /** All available versions (from parent). */
  initialVersions: number[];
  /** API for loading/saving versions. */
  versionApi: VersionApi;
  /** Called when a version is loaded (browsing) with the API response. */
  onVersionLoaded?: (version: number, data: unknown) => void;
  /** Called when an old version is saved as new latest. */
  onVersionSaved?: (version: number, versions: number[], data: unknown) => void;
  /** Whether the rerun action is loading. */
  rerunLoading?: boolean;
  /** Called when the rerun button is clicked. */
  onRerun?: () => void;
  /** Disable rerun (e.g. while editing). */
  rerunDisabled?: boolean;
  /** Tooltip for the rerun button. */
  rerunTitle?: string;
  /** Whether the consumer has unsaved local edits (e.g. pruning, cropping). Takes precedence over version-browse save/discard. */
  isDirty?: boolean;
  /** Called when the user clicks Discard while isDirty. */
  onDirtyDiscard?: () => void;
  /** Called when the user clicks Save while isDirty. When omitted, Save triggers versionApi.saveVersion. */
  onDirtySave?: () => void;
  /** Disable the Save button (e.g. when annotations aren't ready). */
  saveDisabled?: boolean;
  /** Error message to display in the header. */
  error?: string | null;
  /** Optional extra content that replaces the entire right side (e.g. edit-mode buttons). */
  children?: ReactNode;
}

export function NodeHeader({
  title,
  color = "slate",
  initialVersion,
  initialVersions,
  versionApi,
  onVersionLoaded,
  onVersionSaved,
  rerunLoading,
  onRerun,
  rerunDisabled,
  rerunTitle = "Rerun",
  isDirty,
  onDirtyDiscard,
  onDirtySave,
  saveDisabled,
  error,
  children,
}: NodeHeaderProps) {
  const c = colorMap[color];
  const [version, setVersion] = useState(initialVersion);
  const [latestVersion, setLatestVersion] = useState(initialVersion);
  const [isOldVersion, setIsOldVersion] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Versions list comes directly from parent — no internal copy.
  const versions = initialVersions;

  const versionLabel = `v${version}`;

  // When the parent provides a new latest version (e.g. after rerun),
  // jump to it so the label and arrow update together.
  const parentLatest = versions.length > 0 ? versions[versions.length - 1] : initialVersion;
  useEffect(() => {
    if (parentLatest > latestVersion) {
      setVersion(parentLatest);
      setLatestVersion(parentLatest);
      setIsOldVersion(false);
    }
  }, [parentLatest, latestVersion]);

  // Close dropdown on outside click / escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [dropdownOpen]);

  async function handleLoadVersion(v: number) {
    setDropdownOpen(false);
    if (v === version) return;
    try {
      const data = await versionApi.loadVersion(v);
      setVersion(v);
      setIsOldVersion(v !== latestVersion);
      onVersionLoaded?.(v, data);
    } catch {
      // ignore
    }
  }

  async function handleDiscard() {
    try {
      const data = await versionApi.loadVersion(latestVersion);
      setVersion(latestVersion);
      setIsOldVersion(false);
      onVersionLoaded?.(latestVersion, data);
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    setSavingVersion(true);
    try {
      const [result] = await Promise.all([
        versionApi.saveVersion(version),
        new Promise((r) => setTimeout(r, 500)),
      ]);
      setVersion(result.version);
      setLatestVersion(result.version);
      setIsOldVersion(false);
      onVersionSaved?.(result.version, result.versions, result);
    } catch {
      // ignore
    } finally {
      setSavingVersion(false);
    }
  }

  const showSaveDiscard = isDirty || isOldVersion;
  const isSaving = savingVersion;
  const handleSaveClick = isDirty && onDirtySave ? onDirtySave : handleSave;
  const handleDiscardClick = isDirty ? onDirtyDiscard : handleDiscard;

  return (
    <div className={`flex items-center px-4 py-2 ${c.bg}`}>
      <span className="text-sm font-semibold text-white">
        {title}
      </span>
      {error && (
        <span className="ml-2 text-xs font-normal text-red-200">{error}</span>
      )}
      {children ?? (
        <div className="ml-auto flex items-center gap-1.5">
          {showSaveDiscard && (
          <>
            <button
              type="button"
              onClick={handleDiscardClick}
              disabled={isSaving}
              className={`inline-flex items-center cursor-pointer rounded px-2 h-6 text-xs font-medium text-white disabled:opacity-50 transition-colors ${c.btnBg} ${c.btnHover}`}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={isSaving || saveDisabled}
              className={`inline-flex cursor-pointer items-center rounded bg-white px-2 h-6 text-xs font-semibold hover:bg-slate-50 disabled:opacity-70 transition-colors ${c.saveText}`}
            >
              Save
            </button>
          </>
        )}
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={versions.length > 1 ? () => setDropdownOpen(!dropdownOpen) : undefined}
              className={`inline-flex items-center justify-center rounded px-1.5 h-6 min-w-[2.5rem] text-xs font-semibold text-white transition-colors ${c.btnBg} ${versions.length > 1 ? `cursor-pointer ${c.btnHover}` : ""}`}
            >
              {versionLabel} <span className={versions.length > 1 ? "" : "opacity-30"}>▾</span>
            </button>
            {dropdownOpen && (
              <div className={`absolute right-0 top-full z-50 mt-1 max-h-64 w-[200%] overflow-y-auto rounded-lg shadow-lg ${c.dropdownBg}`}>
                {versions.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleLoadVersion(v)}
                    className={`flex w-full items-center px-3 py-1.5 text-left text-xs text-white ${c.dropdownItemHover}`}
                  >
                    {`v${v}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          {onRerun && (
            <button
              type="button"
              onClick={onRerun}
              disabled={rerunDisabled || rerunLoading || isSaving}
              className={`cursor-pointer rounded p-1 text-white/80 hover:text-white disabled:opacity-50 transition-colors ${c.rerunHover}`}
              title={rerunTitle}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 ${rerunLoading || isSaving ? "animate-spin" : ""}`}>
                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.434l.311.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.311H11.768a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.53a.75.75 0 00-1.5 0v2.434l-.311-.312A7 7 0 002.629 8.79a.75.75 0 001.449.39z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
