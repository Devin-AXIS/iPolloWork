// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swallow } from "./diagnostics";

interface HFTestWindow {
  __hfDebug?: boolean;
  __HYPERFRAMES_DEBUG?: boolean;
  __hf?: {
    onSwallowed?: (e: { label: string; error: unknown }) => void;
  };
}

describe("swallow", () => {
  const w = window as unknown as HFTestWindow;
  const originalDebug = console.debug;

  beforeEach(() => {
    delete w.__hfDebug;
    delete w.__HYPERFRAMES_DEBUG;
    delete w.__hf;
    console.debug = vi.fn();
  });

  afterEach(() => {
    console.debug = originalDebug;
    delete w.__hfDebug;
    delete w.__HYPERFRAMES_DEBUG;
    delete w.__hf;
  });

  it("is silent by default — no console output, no handler call", () => {
    swallow("test.silent", new Error("boom"));
    expect(console.debug).not.toHaveBeenCalled();
  });

  it("logs to console.debug when window.__hfDebug is true", () => {
    w.__hfDebug = true;
    const err = new Error("boom");
    swallow("test.debug", err);
    expect(console.debug).toHaveBeenCalledWith("[hyperframes] test.debug swallowed:", err);
  });

  it("also honors window.__HYPERFRAMES_DEBUG (legacy flag)", () => {
    w.__HYPERFRAMES_DEBUG = true;
    swallow("test.legacy", "string-error");
    expect(console.debug).toHaveBeenCalledWith(
      "[hyperframes] test.legacy swallowed:",
      "string-error",
    );
  });

  it("dispatches to window.__hf.onSwallowed when installed", () => {
    const handler = vi.fn();
    w.__hf = { onSwallowed: handler };
    const err = new Error("from handler");
    swallow("test.handler", err);
    expect(handler).toHaveBeenCalledWith({ label: "test.handler", error: err });
  });

  it("does not propagate errors from the user-installed handler", () => {
    w.__hf = {
      onSwallowed: () => {
        throw new Error("handler exploded");
      },
    };
    expect(() => swallow("test.handler-throws", new Error("real"))).not.toThrow();
  });

  it("can run with both handler AND debug flag set", () => {
    w.__hfDebug = true;
    const handler = vi.fn();
    w.__hf = { onSwallowed: handler };
    swallow("test.both", "err");
    expect(handler).toHaveBeenCalled();
    expect(console.debug).toHaveBeenCalled();
  });
});
