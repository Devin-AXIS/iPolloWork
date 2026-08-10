// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { compileMotionInstance, createMotionInstance } from "@hyperframes/core/motion-presets";
import type { DomEditSelection } from "./domEditing";
import {
  resolveMotionInstances,
  resolveMotionTargetKind,
  SemanticMotionPanel,
} from "./SemanticMotionPanel";
import { patchRuntimeTweenInPlace } from "../../hooks/gsapRuntimePatch";

function selection(element: HTMLElement): DomEditSelection {
  return {
    element,
    id: element.id || null,
    selector: element.id ? `#${element.id}` : element.tagName.toLowerCase(),
    label: "Title",
    tagName: element.tagName.toLowerCase(),
    sourceFile: "index.html",
    compositionPath: "main",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 200, height: 40 },
    textContent: element.textContent,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields:
      element.children.length === 0 && Boolean(element.textContent?.trim())
        ? [
            {
              key: "text",
              label: "Text",
              value: element.textContent ?? "",
              tagName: element.tagName.toLowerCase(),
              attributes: [],
              inlineStyles: {},
              computedStyles: {},
              source: "self",
            },
          ]
        : [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: false,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

function semanticAnimation(): GsapAnimation {
  const compiled = compileMotionInstance(
    createMotionInstance({
      presetId: "text.enter.rise",
      target: { selector: "#title", elementId: "title" },
      targetKind: "text",
      start: 1,
      duration: 0.7,
    }),
  );
  return {
    id: "motion-1",
    targetSelector: compiled.targetSelector,
    method: "to",
    position: compiled.position,
    resolvedStart: compiled.position,
    duration: compiled.duration,
    properties: {},
    extras: compiled.extras,
  };
}

describe("SemanticMotionPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it("classifies only leaf editable text as a text motion target", () => {
    const leaf = document.createElement("h1");
    leaf.id = "title";
    leaf.textContent = "你好 AI";
    const containerElement = document.createElement("div");
    containerElement.innerHTML = "<span>Nested</span>";

    expect(resolveMotionTargetKind(selection(leaf))).toBe("text");
    expect(resolveMotionTargetKind(selection(containerElement))).toBe("element");
  });

  it("shows text presets and applies the selected stable preset id", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    const onMutate = vi.fn();
    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(title)}
          animations={[]}
          onMutate={onMutate}
          onPreview={vi.fn()}
        />,
      ),
    );

    const rise = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("浮入"),
    );
    if (!(rise instanceof HTMLButtonElement)) throw new Error("Rise preset missing");
    rise.click();
    expect(onMutate).toHaveBeenCalledWith(
      "text",
      expect.objectContaining({
        operation: "upsert",
        phase: "enter",
        presetId: "text.enter.rise",
      }),
    );
  });

  it("shows the shared preset flow for a general element", () => {
    const card = document.createElement("div");
    card.id = "card";
    card.innerHTML = "<span>Nested content</span>";
    const onMutate = vi.fn();
    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(card)}
          animations={[]}
          onMutate={onMutate}
          onPreview={vi.fn()}
        />,
      ),
    );

    const slide = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("滑入"),
    );
    if (!(slide instanceof HTMLButtonElement)) throw new Error("Element slide preset missing");
    slide.click();
    expect(onMutate).toHaveBeenCalledWith(
      "element",
      expect.objectContaining({
        operation: "upsert",
        phase: "enter",
        presetId: "element.enter.slide",
      }),
    );
  });

  it("restores a saved semantic animation as an editable preset", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    const animation = semanticAnimation();
    const onMutate = vi.fn();
    const onPreview = vi.fn();
    expect(resolveMotionInstances([animation])).toHaveLength(1);

    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(title)}
          animations={[animation]}
          onMutate={onMutate}
          onPreview={onPreview}
        />,
      ),
    );

    const effect = container.querySelector('button[aria-label="动画效果"]');
    expect(effect).toBeInstanceOf(HTMLButtonElement);
    expect(effect?.textContent).toContain("浮入");
    expect(container.textContent).toContain("时长");
    expect(container.textContent).toContain("速度");
    expect(container.textContent).toContain("出现");
    expect(container.textContent).toContain("动作");
    expect(container.textContent).toContain("消失");
    expect(container.textContent).not.toContain("速度曲线");

    const preview = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("预览动画"),
    );
    if (!(preview instanceof HTMLButtonElement)) throw new Error("Preview action missing");
    preview.click();
    expect(onPreview).toHaveBeenCalledWith(1, 0.7);

    const fast = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "快",
    );
    if (!(fast instanceof HTMLButtonElement)) throw new Error("Fast speed action missing");
    fast.click();
    expect(onMutate).toHaveBeenLastCalledWith("text", expect.objectContaining({ duration: 0.45 }));
  });

  it("rebuilds a saved semantic tween in place without reloading the preview", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const target = iframe.contentDocument?.createElement("h1");
    if (!target || !iframe.contentDocument || !iframe.contentWindow) {
      throw new Error("Iframe document unavailable");
    }
    target.id = "title";
    iframe.contentDocument.body.append(target);
    const prior = createMotionInstance({
      presetId: "text.enter.rise",
      target: { selector: "#title", elementId: "title" },
      targetKind: "text",
      start: 1,
      duration: 0.7,
    });
    const next = compileMotionInstance({ ...prior, duration: 1.2 });
    const kill = vi.fn();
    const addTween = vi.fn(() => ({}));
    const seek = vi.fn();
    const timeline = { getChildren: vi.fn(), time: () => prior.start, to: addTween };
    const keyframeWrapper = {
      vars: {},
      duration: () => prior.duration,
      startTime: () => prior.start,
      kill,
      parent: timeline,
    };
    const tween = {
      vars: { opacity: 1 },
      duration: () => prior.duration / 2,
      startTime: () => prior.start,
      targets: () => [target],
      parent: keyframeWrapper,
    };
    timeline.getChildren.mockReturnValue([tween]);
    Object.defineProperty(iframe.contentWindow, "__timelines", {
      configurable: true,
      value: { main: timeline },
    });
    Object.defineProperty(iframe.contentWindow, "__player", {
      configurable: true,
      value: { getTime: () => prior.start, seek },
    });
    expect(
      patchRuntimeTweenInPlace(iframe, next.targetSelector, {
        kind: "motion",
        motionId: prior.id,
        compiled: next,
      }),
    ).toBe(true);
    expect(kill).toHaveBeenCalledOnce();
    expect(addTween).toHaveBeenCalledWith(
      [target],
      expect.objectContaining({ duration: 1.2, ease: next.ease, data: next.extras.data }),
      prior.start,
    );
    expect(seek).toHaveBeenCalledWith(prior.start);
    iframe.remove();
  });

  it("keeps duration slider movement local and persists once on release", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    const onMutate = vi.fn();
    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(title)}
          animations={[semanticAnimation()]}
          onMutate={onMutate}
          onPreview={vi.fn()}
        />,
      ),
    );
    const slider = container.querySelector('[role="slider"][aria-label="时长"]');
    if (!(slider instanceof HTMLDivElement)) throw new Error("Duration slider missing");
    let captured = false;
    Object.defineProperties(slider, {
      getBoundingClientRect: { value: () => new DOMRect(0, 0, 100, 20) },
      setPointerCapture: { value: () => (captured = true) },
      hasPointerCapture: { value: () => captured },
      releasePointerCapture: { value: () => (captured = false) },
    });

    slider.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 30, pointerId: 1 }),
    );
    slider.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 60, pointerId: 1 }),
    );
    expect(onMutate).not.toHaveBeenCalled();
    slider.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, clientX: 60, pointerId: 1 }),
    );
    expect(onMutate).toHaveBeenCalledOnce();
  });
});
