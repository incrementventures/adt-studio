import { Observable, of, shareReplay, last as rxLast } from "rxjs";
import type { AppConfig } from "../config.js";

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
