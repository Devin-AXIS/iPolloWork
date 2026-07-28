import { afterEach, describe, expect, it, vi } from "vitest";
import { wrapScopedCompositionScript } from "./compositionScoping.js";

describe("wrapScopedCompositionScript", () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(window, "__hfScopedWindowEventReceived");
    vi.restoreAllMocks();
  });

  it("binds native window methods when scripts run through the scoped proxy", () => {
    const root = document.createElement("div");
    root.dataset.compositionId = "window-event-test";
    document.body.append(root);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = `
      window.addEventListener("hf-scoped-window-test", function () {
        window.__hfScopedWindowEventReceived = true;
      }, { once: true });
      window.dispatchEvent(new Event("hf-scoped-window-test"));
    `;

    window.eval(wrapScopedCompositionScript(source, "window-event-test"));

    expect(Reflect.get(window, "__hfScopedWindowEventReceived")).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
});
