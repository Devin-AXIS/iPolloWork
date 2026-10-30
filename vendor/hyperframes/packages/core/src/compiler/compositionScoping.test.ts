import { afterEach, describe, expect, it, vi } from "vitest";
import { wrapScopedCompositionScript } from "./compositionScoping.js";

describe("wrapScopedCompositionScript", () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(window, "__hfScopedWindowEventReceived");
    Reflect.deleteProperty(window, "__timelines");
    Reflect.deleteProperty(window, "__hfSecondTimeline");
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

  it("keeps reused timelines isolated when the same authored component mounts twice", () => {
    const first = { clear: vi.fn(function () { return first; }) };
    const second = { clear: vi.fn(function () { return second; }) };
    Reflect.set(window, "__timelines", { diagram: first });
    Reflect.set(window, "__hfSecondTimeline", second);
    const script = `window.__timelines = window.__timelines || {};
      var existing = window.__timelines.diagram;
      window.__timelines.diagram = existing ? existing.clear() : window.__hfSecondTimeline;`;

    window.eval(wrapScopedCompositionScript(script, "diagram", undefined,
      '[data-composition-id="diagram-2"]', "diagram-2"));

    const registry = Reflect.get(window, "__timelines");
    expect(registry.diagram).toBe(first);
    expect(registry["diagram-2"]).toBe(second);
    expect(first.clear).not.toHaveBeenCalled();
    window.eval(wrapScopedCompositionScript(script, "diagram", undefined,
      '[data-composition-id="diagram-2"]', "diagram-2"));
    expect(second.clear).toHaveBeenCalledOnce();
    expect(first.clear).not.toHaveBeenCalled();
  });

  it("preserves the readiness alias when neither runtime mount uses the authored id", () => {
    Reflect.set(window, "__timelines", {});
    const run = (mount: string, label: string) => window.eval(wrapScopedCompositionScript(
      `window.__timelines.diagram = { label: ${JSON.stringify(label)} };`,
      "diagram", undefined, `[data-composition-id="${mount}"]`, mount,
    ));
    run("first-instance", "first");
    run("second-instance", "second");
    const registry = Reflect.get(window, "__timelines");
    expect(registry.diagram).toBe(registry["first-instance"]);
    expect(registry["first-instance"].label).toBe("first");
    expect(registry["second-instance"].label).toBe("second");
    expect(registry["first-instance"]).not.toBe(registry["second-instance"]);
  });

  it("does not reserve the original mount's timeline key when a new instance executes first", () => {
    document.body.innerHTML = `<main data-composition-id="main">
      <div data-composition-id="diagram-2" data-composition-file="diagram.html"><div data-composition-id="diagram"></div></div>
      <div data-composition-id="diagram" data-composition-file="diagram.html"></div>
    </main>`;
    const original = { clear: vi.fn(function () { return original; }) };
    const added = { clear: vi.fn(function () { return added; }) };
    Reflect.set(window, "__timelines", {});
    Reflect.set(window, "__hfSecondTimeline", added);
    const script = `var existing = window.__timelines.diagram;
      window.__hfSecondTimeline.root = document.querySelector('[data-composition-id="diagram"]');
      window.__timelines.diagram = existing ? existing.clear() : window.__hfSecondTimeline;`;
    window.eval(wrapScopedCompositionScript(script, "diagram", undefined,
      '[data-composition-id="diagram-2"]', "diagram-2"));
    Reflect.set(window, "__hfSecondTimeline", original);
    window.eval(wrapScopedCompositionScript(script, "diagram"));
    const registry = Reflect.get(window, "__timelines");
    expect(registry.diagram).toBe(original);
    expect(registry["diagram-2"]).toBe(added);
    expect(added.clear).not.toHaveBeenCalled();
    expect(Reflect.get(original, "root")).toBe(document.querySelector('[data-composition-id="diagram"][data-composition-file]'));
  });
});
