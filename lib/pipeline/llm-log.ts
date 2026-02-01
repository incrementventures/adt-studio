import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModelMessage } from "ai";

interface LlmLogMeta {
  label: string;
  taskType: string;
  pageId?: string;
}

export interface LlmLogTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface LlmLogEntry {
  timestamp: string;
  label: string;
  taskType: string;
  pageId?: string;
  promptName: string;
  modelId: string;
  cacheHit: boolean;
  attempt: number;
  durationMs: number;
  usage?: LlmLogTokenUsage;
  validationErrors?: string[];
  system?: string;
  messages: LlmLogMessage[];
}

export type LlmLogMessage = {
  role: string;
  content: (LlmLogTextPart | LlmLogImagePlaceholder)[];
};

type LlmLogTextPart = { type: "text"; text: string };
export type LlmLogImagePlaceholder = {
  type: "image";
  hash: string;
  byteLength: number;
  width: number;
  height: number;
};

/**
 * Strip base64 image data from AI SDK messages, replacing with
 * a placeholder that records the byte length.
 */
export function sanitizeMessages(messages: ModelMessage[]): LlmLogMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: [{ type: "text" as const, text: m.content }] };
    }
    if (!Array.isArray(m.content)) {
      return { role: m.role, content: [{ type: "text" as const, text: String(m.content) }] };
    }
    const parts = (m.content as Array<Record<string, unknown>>).map((part) => {
      if (part.type === "image" || part.type === "image_url") {
        const data =
          (part.image as string) ??
          (part.data as string) ??
          ((part.image_url as Record<string, string>)?.url as string) ??
          "";
        const byteLength = Math.round((data.length * 3) / 4);
        const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
        const { width, height } = pngDimensions(data);
        return { type: "image" as const, hash, byteLength, width, height };
      }
      if (part.type === "text") {
        return { type: "text" as const, text: (part.text as string) ?? "" };
      }
      // Unknown part type — stringify compactly
      return { type: "text" as const, text: JSON.stringify(part) };
    });
    return { role: m.role, content: parts };
  });
}

/**
 * Read PNG width and height from the IHDR chunk in a base64-encoded PNG.
 * Width is at byte offset 16, height at 20 (both big-endian uint32).
 * We only need to decode the first 24 bytes (32 base64 chars covers that).
 */
function pngDimensions(base64: string): { width: number; height: number } {
  try {
    const buf = Buffer.from(base64.slice(0, 32), "base64");
    if (buf.length < 24) return { width: 0, height: 0 };
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Compute the same hash used in log entries for a base64 image string.
 */
export function hashBase64(base64: string): string {
  return createHash("sha256").update(base64).digest("hex").slice(0, 16);
}

const TASK_TYPE_TO_DIR: Record<string, string> = {
  "web-edit": "web-rendering",
};

/**
 * Resolve the cache directory for a given log metadata.
 */
export function resolveCacheDir(meta: LlmLogMeta): string {
  const booksRoot = path.resolve(process.env.BOOKS_ROOT ?? "books");
  const dirName = TASK_TYPE_TO_DIR[meta.taskType] ?? meta.taskType;
  return path.join(booksRoot, meta.label, dirName);
}

/**
 * Resolve the log file path for a book label.
 */
function logPath(label: string): string {
  const booksRoot = path.resolve(process.env.BOOKS_ROOT ?? "books");
  return path.join(booksRoot, label, "llm-log.jsonl");
}

const MAX_LOG_ENTRIES = 250;

/**
 * Append a log entry to the book's JSONL log file, keeping at most
 * MAX_LOG_ENTRIES entries (oldest are dropped).
 */
export function appendLogEntry(entry: LlmLogEntry): void {
  const filePath = logPath(entry.label);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");

  // Trim if over limit
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  if (lines.length > MAX_LOG_ENTRIES) {
    fs.writeFileSync(filePath, lines.slice(lines.length - MAX_LOG_ENTRIES).join("\n") + "\n");
  }
}
