import { describe, it, expect, vi } from "vitest";
import { lastValueFrom, toArray, Observable, of } from "rxjs";
import { defineNode, createContext, resolveNode, type PipelineContext } from "../node.js";
import type { AppConfig } from "../../config.js";

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return createContext("test-label", {
    config: {
      text_types: {},
      text_group_types: {},
    } as AppConfig,
    outputRoot: "books",
    ...overrides,
  });
}

describe("defineNode", () => {
  it("runs resolve when isComplete returns null", async () => {
    const resolveFn = vi.fn(
      () =>
        new Observable<string>((sub) => {
          sub.next("a");
          sub.next("b");
          sub.complete();
        })
    );

    const node = defineNode<string>({
      name: "test-node",
      isComplete: () => null,
      resolve: resolveFn,
    });

    const ctx = makeCtx();
    const result = await lastValueFrom(node.resolve(ctx).pipe(toArray()));

    expect(result).toEqual(["a", "b"]);
    expect(resolveFn).toHaveBeenCalledOnce();
  });

  it("returns cached value when isComplete returns non-null", async () => {
    const resolveFn = vi.fn(() => of("should-not-run"));

    const node = defineNode<string>({
      name: "done-node",
      isComplete: () => "cached-value",
      resolve: resolveFn,
    });

    const ctx = makeCtx();
    const result = await lastValueFrom(node.resolve(ctx).pipe(toArray()));

    expect(result).toEqual(["cached-value"]);
    expect(resolveFn).not.toHaveBeenCalled();
  });

  it("memoizes the observable per context", async () => {
    let callCount = 0;

    const node = defineNode<string>({
      name: "memo-node",
      resolve: () => {
        callCount++;
        return of("value");
      },
    });

    const ctx = makeCtx();
    const obs1 = node.resolve(ctx);
    const obs2 = node.resolve(ctx);

    expect(obs1).toBe(obs2);
    expect(callCount).toBe(1);

    await lastValueFrom(obs1);
    await lastValueFrom(obs2);
    expect(callCount).toBe(1);
  });

  it("does not share memoization across different contexts", async () => {
    let callCount = 0;

    const node = defineNode<string>({
      name: "multi-ctx-node",
      resolve: () => {
        callCount++;
        return of("value");
      },
    });

    const ctx1 = makeCtx();
    const ctx2 = makeCtx();

    await lastValueFrom(node.resolve(ctx1));
    await lastValueFrom(node.resolve(ctx2));

    expect(callCount).toBe(2);
  });

  it("resolves dependency nodes before running", async () => {
    const order: string[] = [];

    const depNode = defineNode<string>({
      name: "dep",
      resolve: () =>
        new Observable<string>((sub) => {
          order.push("dep");
          sub.next("dep-value");
          sub.complete();
        }),
    });

    const mainNode = defineNode<string>({
      name: "main",
      resolve: (ctx) => {
        return new Observable<string>((sub) => {
          depNode.resolve(ctx).subscribe({
            next() {},
            complete() {
              order.push("main");
              sub.next("main-value");
              sub.complete();
            },
          });
        });
      },
    });

    const ctx = makeCtx();
    const result = await resolveNode(mainNode, ctx);

    expect(order).toEqual(["dep", "main"]);
    expect(result).toBe("main-value");
  });

  it("skips resolve when isComplete returns a value (dependency not triggered)", async () => {
    const depResolveFn = vi.fn(() => of("dep-value"));

    const depNode = defineNode<string>({
      name: "dep",
      resolve: depResolveFn,
    });

    const mainNode = defineNode<string>({
      name: "main",
      isComplete: () => "already-done",
      resolve: (ctx) =>
        new Observable<string>((sub) => {
          depNode.resolve(ctx).subscribe({
            complete() {
              sub.next("main-value");
              sub.complete();
            },
          });
        }),
    });

    const ctx = makeCtx();
    const result = await resolveNode(mainNode, ctx);

    expect(result).toBe("already-done");
    expect(depResolveFn).not.toHaveBeenCalled();
  });
});

describe("resolveNode", () => {
  it("returns the last emitted value", async () => {
    const node = defineNode<string>({
      name: "multi-emit",
      resolve: () =>
        new Observable<string>((sub) => {
          sub.next("progress-1");
          sub.next("progress-2");
          sub.next("final");
          sub.complete();
        }),
    });

    const ctx = makeCtx();
    const result = await resolveNode(node, ctx);
    expect(result).toBe("final");
  });

  it("rejects if the node completes without emitting", async () => {
    const node = defineNode<string>({
      name: "empty-node",
      resolve: () =>
        new Observable<string>((sub) => {
          sub.complete();
        }),
    });

    const ctx = makeCtx();
    await expect(resolveNode(node, ctx)).rejects.toThrow(
      'Node "empty-node" completed without emitting a value'
    );
  });
});

describe("createContext", () => {
  it("creates a context with defaults", () => {
    const ctx = createContext("my-label", {
      config: { text_types: {}, text_group_types: {} } as AppConfig,
    });

    expect(ctx.label).toBe("my-label");
    expect(ctx.outputRoot).toBe("books");
    expect(ctx.provider).toBe("openai");
    expect(ctx.cache).toBeInstanceOf(Map);
    expect(ctx.cache.size).toBe(0);
  });

  it("accepts overrides", () => {
    const ctx = createContext("label", {
      config: { text_types: {}, text_group_types: {} } as AppConfig,
      outputRoot: "/custom/root",
      provider: "anthropic",
    });

    expect(ctx.outputRoot).toBe("/custom/root");
    expect(ctx.provider).toBe("anthropic");
  });
});
