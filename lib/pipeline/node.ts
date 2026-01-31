import { Observable, of, shareReplay, last as rxLast } from "rxjs";
import type { LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { AppConfig } from "../config";

export type LLMProvider = "openai" | "anthropic" | "google";

export interface PipelineContext {
  label: string;
  outputRoot: string;
  config: AppConfig;
  provider: LLMProvider;
  cache: Map<unknown, Observable<unknown>>;
}

export interface Node<T> {
  readonly name: string;
  resolve(ctx: PipelineContext): Observable<T>;
}

export function defineNode<T>(config: {
  name: string;
  resolve: (ctx: PipelineContext) => Observable<T>;
  isComplete?: (ctx: PipelineContext) => T | null;
}): Node<T> {
  return {
    name: config.name,
    resolve(ctx: PipelineContext): Observable<T> {
      const cached = ctx.cache.get(this);
      if (cached) return cached as Observable<T>;

      let obs: Observable<T>;

      if (config.isComplete) {
        const existing = config.isComplete(ctx);
        if (existing !== null) {
          obs = of(existing).pipe(shareReplay(1));
          ctx.cache.set(this, obs as Observable<unknown>);
          return obs;
        }
      }

      obs = config.resolve(ctx).pipe(shareReplay({ bufferSize: 1, refCount: false }));
      ctx.cache.set(this, obs as Observable<unknown>);
      return obs;
    },
  };
}

export function createContext(
  label: string,
  options: {
    config: AppConfig;
    outputRoot?: string;
    provider?: LLMProvider;
  }
): PipelineContext {
  return {
    label,
    outputRoot: options.outputRoot ?? "books",
    config: options.config,
    provider: options.provider ?? "openai",
    cache: new Map(),
  };
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-5.2",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-pro",
};

const MODEL_FACTORIES: Record<string, (id: string) => LanguageModel> = {
  openai: (id) => openai(id),
  anthropic: (id) => anthropic(id),
  google: (id) => google(id),
};

export function resolveModel(
  ctx: PipelineContext,
  configModel?: string
): LanguageModel {
  if (configModel) {
    // Format: "provider:model-id" or just "model-id" (uses ctx.provider)
    const colonIdx = configModel.indexOf(":");
    if (colonIdx !== -1) {
      const provider = configModel.slice(0, colonIdx) as LLMProvider;
      const modelId = configModel.slice(colonIdx + 1);
      return MODEL_FACTORIES[provider](modelId);
    }
    return MODEL_FACTORIES[ctx.provider](configModel);
  }
  return MODEL_FACTORIES[ctx.provider](DEFAULT_MODELS[ctx.provider]);
}

export function resolveNode<T>(node: Node<T>, ctx: PipelineContext): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let lastValue: T | undefined;
    let hasValue = false;
    node.resolve(ctx).subscribe({
      next(v) {
        lastValue = v;
        hasValue = true;
      },
      error: reject,
      complete() {
        if (hasValue) resolve(lastValue!);
        else reject(new Error(`Node "${node.name}" completed without emitting a value`));
      },
    });
  });
}
