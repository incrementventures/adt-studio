import fs from "node:fs";
import path from "node:path";
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
import { loadConfig } from "../../config";

export type { LLMProvider } from "../node";

const MAX_PAGES = 15;

export interface MetadataProgress {
  phase: "loading" | "calling-llm" | "done";
  label: string;
}

export const metadataNode: Node<BookMetadata> = defineNode<
  BookMetadata | MetadataProgress
>({
  name: "metadata",
  isComplete: (ctx) => {
    const metadataFile = path.resolve(
      ctx.outputRoot,
      ctx.label,
      "metadata",
      "metadata.json"
    );
    if (!fs.existsSync(metadataFile)) return null;
    return JSON.parse(fs.readFileSync(metadataFile, "utf-8"));
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

          const metadataDir = path.resolve(
            ctx.outputRoot,
            ctx.label,
            "metadata"
          );
          const metadataFile = path.join(metadataDir, "metadata.json");

          const metadata = await cachedPromptGenerateObject<BookMetadata>({
            model: resolveModel(ctx, ctx.config.metadata?.model),
            schema: bookMetadataSchema,
            promptName: ctx.config.metadata?.prompt ?? "metadata_extraction",
            promptContext: { pages },
            cacheDir: metadataDir,
          });

          fs.mkdirSync(metadataDir, { recursive: true });
          fs.writeFileSync(
            metadataFile,
            JSON.stringify(metadata, null, 2) + "\n"
          );

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
  const config = loadConfig();
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
