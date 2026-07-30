import { describe, expect, it, vi } from "vitest";

import { PreviewController, type PreviewCleanup } from "./PreviewController";

describe("PreviewController", () => {
  it("keeps at most one preview active", async () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    const controller = new PreviewController();

    controller.start("first", async () => firstCleanup);
    await Promise.resolve();
    controller.start("second", async () => secondCleanup);
    await Promise.resolve();

    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(controller.activeId).toBe("second");

    controller.dispose();
    expect(secondCleanup).toHaveBeenCalledOnce();
  });

  it("cleans a stale resource that resolves after cancellation", async () => {
    let resolveFirst: ((cleanup: PreviewCleanup) => void) | undefined;
    const staleCleanup = vi.fn();
    const controller = new PreviewController();

    controller.start(
      "first",
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    controller.stop("first");
    resolveFirst?.(staleCleanup);
    await Promise.resolve();

    expect(staleCleanup).toHaveBeenCalledOnce();
    expect(controller.activeId).toBeNull();
  });

  it("aborts initialization when the active preview is stopped", () => {
    let signal: AbortSignal | undefined;
    const controller = new PreviewController();

    controller.start("first", async (context) => {
      signal = context.signal;
      return undefined;
    });
    controller.stop("first");

    expect(signal?.aborted).toBe(true);
  });
});
