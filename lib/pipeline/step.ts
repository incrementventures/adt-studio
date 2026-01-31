import { Observable, concat, defer, EMPTY } from "rxjs";
import type { BookPaths, PipelineOptions } from "./types.js";
import { resolveBookPaths } from "./types.js";

export interface Step<TProgress> {
  readonly name: string;
  isComplete(paths: BookPaths): boolean;
  run(label: string, options?: PipelineOptions): Observable<TProgress>;
}

export function defineStep<TProgress>(config: {
  name: string;
  deps?: Step<unknown>[];
  isComplete: (paths: BookPaths) => boolean;
  execute: (
    paths: BookPaths,
    options: PipelineOptions
  ) => Observable<TProgress>;
}): Step<TProgress> {
  return {
    name: config.name,
    isComplete: config.isComplete,
    run(label: string, options: PipelineOptions = {}): Observable<TProgress> {
      const paths = resolveBookPaths(label, options.outputRoot);
      if (config.isComplete(paths)) return EMPTY;

      const depStreams = (config.deps ?? []).map((dep) =>
        defer(() =>
          dep.isComplete(paths) ? EMPTY : dep.run(label, options)
        )
      );

      return concat(
        ...depStreams,
        defer(() => config.execute(paths, options))
      ) as Observable<TProgress>;
    },
  };
}
