// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useToast } from "./useToast";

function mountToastHarness() {
  let current: ReturnType<typeof useToast> | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);

  function Harness(): ReactNode {
    current = useToast();
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    getCurrent: () => {
      if (!current) throw new Error("Toast harness did not mount");
      return current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useToast", () => {
  it("keeps loading visible until the task dismisses it and auto-dismisses success", () => {
    vi.useFakeTimers();
    const harness = mountToastHarness();
    let loadingId = 0;

    act(() => {
      loadingId = harness.getCurrent().showToast("Adding component…", "loading");
    });
    expect(harness.getCurrent().toasts).toMatchObject([
      { id: loadingId, message: "Adding component…", tone: "loading" },
    ]);

    act(() => vi.advanceTimersByTime(10_000));
    expect(harness.getCurrent().toasts).toHaveLength(1);

    act(() => harness.getCurrent().dismissToast(loadingId));
    act(() => vi.advanceTimersByTime(160));
    expect(harness.getCurrent().toasts).toHaveLength(0);

    act(() => {
      harness.getCurrent().showToast("Component added", "success");
    });
    expect(harness.getCurrent().toasts[0]?.tone).toBe("success");
    act(() => vi.advanceTimersByTime(4_160));
    expect(harness.getCurrent().toasts).toHaveLength(0);

    act(() => {
      harness.getCurrent().showToast("Component failed", "error");
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(harness.getCurrent().toasts[0]?.tone).toBe("error");
    harness.unmount();
  });
});
