import fs from "node:fs";
import { Observable } from "rxjs";
import { cachedPromptGenerateObject } from "../cache";
import { bookMetadataSchema, type BookMetadata } from "./metadata-schema";
import {
  defineNode,
  createContext,
  resolveNode,
  resolveModel,
  type PipelineContext,
  type LLMProvider,
  type Node,
} from "../node";
import { pagesNode, type Page } from "../extract/extract";
import { loadBookConfig } from "../../config";
import { putBookMetadata } from "@/lib/books";
import { getDb } from "@/lib/db";

export type { LLMProvider } from "../node";

const MAX_PAGES = 3;

export interface MetadataProgress {
  phase: "loading" | "calling-llm" | "done";
  label: string;
}

export const metadataNode: Node<BookMetadata> = defineNode<
  BookMetadata | MetadataProgress
>({
  name: "metadata",
  isComplete: (ctx) => {
    // Only consider complete if LLM-generated metadata exists (not just the stub)
    const db = getDb(ctx.label);
    const row = db
      .prepare("SELECT data FROM book_metadata WHERE source = 'llm'")
      .get() as { data: string } | undefined;
    if (!row) return null;
    const raw = JSON.parse(row.data);
    const result = bookMetadataSchema.safeParse(raw);
    return result.success ? result.data : null;
  },
  resolve: (ctx) => {
    return new Observable<BookMetadata | MetadataProgress>((subscriber) => {
      (async () => {
        try {
          subscriber.next({ phase: "loading", label: ctx.label });

          const allPages = await resolveNode(pagesNode, ctx);

          const pages = allPages.slice(0, MAX_PAGES).map((p) => ({
            pageNumber: p.pageNumber,
            text: p.text,
            imageBase64: fs.readFileSync(p.imagePath).toString("base64"),
          }));

          subscriber.next({ phase: "calling-llm", label: ctx.label });

          const metadata = await cachedPromptGenerateObject<BookMetadata>({
            label: ctx.label,
            taskType: "metadata",
            model: resolveModel(ctx, ctx.config.metadata?.model),
            schema: bookMetadataSchema,
            promptName: ctx.config.metadata?.prompt ?? "metadata_extraction",
            promptContext: { pages },
          });

          putBookMetadata(ctx.label, "llm", metadata);

          subscriber.next({ phase: "done", label: ctx.label });
          subscriber.next(metadata);
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  },
}) as Node<BookMetadata>;

export function extractMetadata(
  label: string,
  options?: { provider?: LLMProvider; outputRoot?: string }
): Observable<MetadataProgress> {
  const config = loadBookConfig(label);
  const ctx = createContext(label, {
    config,
    outputRoot: options?.outputRoot,
    provider: options?.provider ?? (config.provider as LLMProvider | undefined),
  });

  return new Observable<MetadataProgress>((subscriber) => {
    metadataNode.resolve(ctx).subscribe({
      next(v) {
        if (v && typeof v === "object" && "phase" in v && "label" in v) {
          subscriber.next(v as unknown as MetadataProgress);
        }
      },
      error: (err) => subscriber.error(err),
      complete: () => subscriber.complete(),
    });
  });
}
