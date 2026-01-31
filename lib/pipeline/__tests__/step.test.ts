import { describe, it, expect, vi } from "vitest";
import { lastValueFrom, toArray, of, Observable } from "rxjs";
import { defineStep } from "../step.js";
import type { Step } from "../step.js";
import type { BookPaths } from "../types.js";
import { resolveBookPaths } from "../types.js";

describe("defineStep", () => {
  it("runs execute when not complete and has no deps", async () => {
    const executeFn = vi.fn(
      () =>
        new Observable<string>((sub) => {
          sub.next("a");
          sub.next("b");
          sub.complete();
        })
    );

    const step = defineStep<string>({
      name: "test-step",
      isComplete: () => false,
      execute: executeFn,
    });

    const result = await lastValueFrom(
      step.run("label").pipe(toArray())
    );

    expect(result).toEqual(["a", "b"]);
    expect(executeFn).toHaveBeenCalledOnce();
  });

  it("returns EMPTY when already complete", async () => {
    const executeFn = vi.fn(() => of("x"));

    const step = defineStep<string>({
      name: "done-step",
      isComplete: () => true,
      execute: executeFn,
    });

    const result = await lastValueFrom(
      step.run("label").pipe(toArray())
    );

    expect(result).toEqual([]);
    expect(executeFn).not.toHaveBeenCalled();
  });

  it("runs incomplete deps before execute via concat", async () => {
    const order: string[] = [];

    const dep: Step<string> = {
      name: "dep",
      isComplete: () => false,
      run: () =>
        new Observable<string>((sub) => {
          order.push("dep");
          sub.next("dep-progress");
          sub.complete();
        }),
    };

    const step = defineStep<string>({
      name: "main",
      deps: [dep],
      isComplete: () => false,
      execute: () =>
        new Observable<string>((sub) => {
          order.push("main");
          sub.next("main-progress");
          sub.complete();
        }),
    });

    const result = await lastValueFrom(
      step.run("label").pipe(toArray())
    );

    expect(order).toEqual(["dep", "main"]);
    expect(result).toEqual(["dep-progress", "main-progress"]);
  });

  it("skips deps that are already complete", async () => {
    const paths = resolveBookPaths("label", "books");
    const depRunFn = vi.fn(() => of("dep-progress"));

    const dep: Step<string> = {
      name: "complete-dep",
      isComplete: () => true,
      run: depRunFn,
    };

    const step = defineStep<string>({
      name: "main",
      deps: [dep],
      isComplete: () => false,
      execute: () => of("main-progress"),
    });

    const result = await lastValueFrom(
      step.run("label").pipe(toArray())
    );

    expect(depRunFn).not.toHaveBeenCalled();
    expect(result).toEqual(["main-progress"]);
  });
});
