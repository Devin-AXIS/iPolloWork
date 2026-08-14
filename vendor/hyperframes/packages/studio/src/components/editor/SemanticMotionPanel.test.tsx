// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { compileMotionInstance, createMotionInstance } from "@hyperframes/core/motion-presets";
import { findElementForSelection, type DomEditSelection } from "./domEditing";
import { collectDomEditTextFields, resolveDomEditSelection } from "./domEditingLayers";
import {
  AnimationPropertiesPanel,
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
    textFields: collectDomEditTextFields(element),
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

function semanticAnimation(options: { duration?: number; loop?: boolean } = {}): GsapAnimation {
  const compiled = compileMotionInstance(
    createMotionInstance({
      presetId: "text.enter.rise",
      target: { selector: "#title", elementId: "title" },
      targetKind: "text",
      start: 1,
      duration: options.duration ?? 0.7,
      loop: options.loop ?? false,
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

function installMotionPreviewTimeline() {
  let complete: (() => void) | null = null;
  const timeline = {
    to: vi.fn(),
    play: vi.fn(),
    eventCallback: vi.fn(),
    kill: vi.fn(),
  };
  timeline.to.mockReturnValue(timeline);
  timeline.eventCallback.mockImplementation((_type: string, callback: () => void) => {
    complete = callback;
    return timeline;
  });
  const createTimeline = vi.fn(() => timeline);
  Object.defineProperty(window, "gsap", {
    configurable: true,
    value: { timeline: createTimeline },
  });
  return {
    timeline,
    createTimeline,
    complete: () => complete?.(),
  };
}

describe("SemanticMotionPanel", () => {
  it("does not rebind a stale stable-id selection to a same-tag sibling", () => {
    const previewDocument = document.implementation.createHTMLDocument();
    previewDocument.body.innerHTML = `
      <h2 data-hf-id="hf-first">First</h2>
      <h2 data-hf-id="hf-second">Second</h2>
    `;

    expect(
      findElementForSelection(previewDocument, {
        hfId: "hf-deleted",
        selector: "h2",
        selectorIndex: 0,
      }),
    ).toBeNull();
    expect(
      findElementForSelection(previewDocument, {
        hfId: "hf-second",
        selector: "h2",
        selectorIndex: 0,
      })?.textContent,
    ).toBe("Second");
  });

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
    Reflect.deleteProperty(window, "gsap");
    vi.unstubAllGlobals();
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

  it("keeps structured text motion wrappers selectable as text", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.setAttribute("data-ipw-motion-structure", "v1");
    title.setAttribute("data-ipw-motion-source", JSON.stringify("Duty, not consequence."));
    title.innerHTML = `
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">Duty,</span>
      </span>
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">not</span>
      </span>
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">consequence.</span>
      </span>
    `;

    expect(resolveMotionTargetKind(selection(title))).toBe("text");
  });

  it("collects structured text motion as the original editable text field", () => {
    const title = document.createElement("h1");
    title.setAttribute("data-ipw-motion-structure", "v1");
    title.setAttribute("data-ipw-motion-source", JSON.stringify("Duty, not consequence."));
    title.innerHTML = `
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">Duty,</span>
      </span>
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">not</span>
      </span>
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">consequence.</span>
      </span>
    `;

    expect(collectDomEditTextFields(title)).toMatchObject([
      {
        source: "self",
        value: "Duty, not consequence.",
      },
    ]);
  });

  it("collects legacy character motion as one original editable text field", () => {
    const title = document.createElement("h1");
    title.setAttribute("data-ipw-motion-split", "v1");
    title.setAttribute("data-ipw-motion-source", JSON.stringify("Make motion clear."));
    title.innerHTML = `
      <span data-ipw-motion-word="">
        <span data-ipw-motion-char="">M</span><span data-ipw-motion-char="">a</span>
      </span>
    `;

    expect(collectDomEditTextFields(title)).toMatchObject([
      {
        source: "self",
        value: "Make motion clear.",
      },
    ]);
    expect(resolveMotionTargetKind(selection(title))).toBe("text");
  });

  it("resolves clicks on structured motion words to the authored text element", async () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.setAttribute("data-ipw-motion-structure", "v1");
    title.setAttribute("data-ipw-motion-source", JSON.stringify("Duty, not consequence."));
    title.innerHTML = `
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">Duty,</span>
      </span>
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">not</span>
      </span>
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">consequence.</span>
      </span>
    `;
    document.body.append(title);
    const clickedWord = Array.from(
      title.querySelectorAll<HTMLElement>('[data-ipw-motion-role="text"]'),
    ).at(-1);
    if (!clickedWord) throw new Error("Structured word text is missing");

    const resolved = await resolveDomEditSelection(clickedWord, {
      activeCompositionPath: "index.html",
      isMasterView: true,
      skipSourceProbe: true,
    });

    expect(resolved?.element).toBe(title);
    expect(resolved?.textFields).toMatchObject([
      {
        source: "self",
        value: "Duty, not consequence.",
      },
    ]);
    title.remove();
  });

  it("previews a draft and only persists speed and loop after confirmation", async () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    title.style.opacity = "0.4";
    document.body.append(title);
    const currentFrameStyle = title.getAttribute("style");
    const selected = selection(title);
    const instance = createMotionInstance({
      presetId: "text.enter.rise",
      target: { selector: "#title", elementId: "title" },
      targetKind: "text",
      start: 0,
    });
    const { timeline, createTimeline, complete } = installMotionPreviewTimeline();
    const onMutate = vi.fn().mockResolvedValue(true);
    const onApplied = vi.fn();

    flushSync(() =>
      root.render(
        <AnimationPropertiesPanel
          draft={{
            templateId: "general-slide-in",
            presetId: instance.presetId,
            targetKind: instance.targetKind,
            applicationKind: "general",
            selection: selected,
            parameters: instance.parameters,
          }}
          element={selected}
          animations={[semanticAnimation({ duration: 1.4, loop: true })]}
          onMutate={onMutate}
          onApplied={onApplied}
        />,
      ),
    );

    expect(container.querySelector('[role="slider"][aria-label="动画速度"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="开始时间"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="结束时间"]')).not.toBeNull();
    expect(createTimeline).toHaveBeenCalledWith({ paused: true });
    expect(timeline.to).toHaveBeenCalledOnce();
    expect(timeline.to.mock.calls[0]?.[0]).toBe(title);
    expect(timeline.play).toHaveBeenCalledWith(0);
    expect(onMutate).not.toHaveBeenCalled();
    const loopSwitch = container.querySelector('[role="switch"]');
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "确定应用",
    );
    if (!(loopSwitch instanceof HTMLButtonElement) || !confirm) {
      throw new Error("Animation property controls are missing");
    }
    const loopThumb = loopSwitch.querySelector("span");
    if (!(loopThumb instanceof HTMLSpanElement)) throw new Error("Loop switch thumb is missing");
    expect(loopSwitch.getAttribute("aria-checked")).toBe("false");
    expect(loopSwitch.className).toContain("p-0.5");
    expect(loopThumb.className).toContain("translate-x-0");
    expect(container.textContent).toContain("1.00×");
    flushSync(() => loopSwitch.click());
    expect(loopThumb.className).toContain("translate-x-4");
    confirm.click();
    await Promise.resolve();

    expect(onMutate).toHaveBeenCalledWith(
      "text",
      expect.objectContaining({
        operation: "upsert",
        presetId: "text.enter.rise",
        templateId: "general-slide-in",
        applicationKind: "general",
        start: 0,
        end: 0.65,
        duration: 0.65,
        loop: true,
      }),
      selected,
    );
    expect(onApplied).toHaveBeenCalledOnce();
    expect(createTimeline).toHaveBeenCalledTimes(2);
    const appliedEditor = (
      <AnimationPropertiesPanel
        draft={null}
        element={selected}
        animations={[semanticAnimation({ duration: 0.65, loop: true })]}
        onMutate={onMutate}
        onApplied={onApplied}
      />
    );
    flushSync(() => root.render(appliedEditor));
    expect(createTimeline).toHaveBeenCalledTimes(3);
    expect(timeline.to).toHaveBeenCalledTimes(3);
    expect(timeline.to.mock.calls.at(-1)?.[0]).toBe(title);
    flushSync(() => root.render(appliedEditor));
    expect(createTimeline).toHaveBeenCalledTimes(3);
    complete();
    expect(title.getAttribute("style")).toBe(currentFrameStyle);
    title.remove();
  });

  it("drives the selected-element preview independently while video playback stays paused", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    title.style.opacity = "0.4";
    document.body.append(title);
    const selected = selection(title);
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    );
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const timeline = {
      to: vi.fn(),
      play: vi.fn(),
      progress: vi.fn(),
      eventCallback: vi.fn(),
      kill: vi.fn(),
    };
    timeline.to.mockReturnValue(timeline);
    timeline.progress.mockReturnValue(timeline);
    timeline.eventCallback.mockReturnValue(timeline);
    Object.defineProperty(window, "gsap", {
      configurable: true,
      value: { timeline: vi.fn(() => timeline) },
    });

    flushSync(() =>
      root.render(
        <AnimationPropertiesPanel
          draft={{
            templateId: "general-fade-in",
            presetId: "text.enter.fade",
            targetKind: "text",
            applicationKind: "general",
            selection: selected,
            parameters: {},
          }}
          element={selected}
          animations={[]}
          onMutate={vi.fn().mockResolvedValue(true)}
          onApplied={vi.fn()}
        />,
      ),
    );

    expect(timeline.to.mock.calls[0]?.[0]).toBe(title);
    expect(timeline.play).not.toHaveBeenCalled();
    expect(timeline.progress).toHaveBeenCalledWith(0);
    frameCallbacks.shift()?.(1_000);
    frameCallbacks.shift()?.(1_325);
    expect(timeline.progress).toHaveBeenCalledWith(0.5);
    frameCallbacks.shift()?.(1_650);
    expect(timeline.progress).toHaveBeenCalledWith(1);
    expect(timeline.kill).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(title.style.opacity).toBe("0.4");
    title.remove();
  });

  it("previews whole-element motion around the element's dragged GSAP position", () => {
    const title = document.createElement("h1");
    title.id = "dragged-title";
    title.textContent = "Dragged title";
    document.body.append(title);
    const selected = selection(title);
    const timeline = {
      to: vi.fn(),
      play: vi.fn(),
      eventCallback: vi.fn(),
      kill: vi.fn(),
    };
    timeline.to.mockReturnValue(timeline);
    timeline.eventCallback.mockReturnValue(timeline);
    Object.defineProperty(window, "gsap", {
      configurable: true,
      value: {
        timeline: vi.fn(() => timeline),
        getProperty: vi.fn((_target: Element, property: string) => (property === "x" ? 120 : 240)),
      },
    });

    flushSync(() =>
      root.render(
        <AnimationPropertiesPanel
          draft={{
            templateId: "text-rise",
            presetId: "text.enter.rise",
            targetKind: "text",
            applicationKind: "general",
            selection: selected,
            parameters: {
              ease: "power2.out",
              intensity: 1,
              unit: "whole",
              stagger: 0.04,
              direction: "up",
            },
          }}
          element={selected}
          animations={[]}
          onMutate={vi.fn().mockResolvedValue(true)}
          onApplied={vi.fn()}
        />,
      ),
    );

    const vars = timeline.to.mock.calls[0]?.[1];
    expect(vars.keyframes["0%"]).toMatchObject({ x: 120, y: 282 });
    expect(vars.keyframes["100%"]).toMatchObject({ x: 120, y: 240 });
    title.remove();
  });

  it("keeps the draft open and reports a failed animation save", async () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    const selected = selection(title);
    const onApplied = vi.fn();

    flushSync(() =>
      root.render(
        <AnimationPropertiesPanel
          draft={{
            templateId: "general-fade-in",
            presetId: "text.enter.fade",
            targetKind: "text",
            applicationKind: "general",
            selection: selected,
            parameters: {},
          }}
          element={selected}
          animations={[]}
          onMutate={vi.fn().mockResolvedValue(false)}
          onApplied={onApplied}
        />,
      ),
    );

    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "确定应用",
    );
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("Confirm action missing");
    confirm.click();

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("动画未能保存");
    });
    expect(onApplied).not.toHaveBeenCalled();
    expect(confirm.disabled).toBe(false);
  });

  it("previews Highlight as reversible per-word structured tracks", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.setAttribute("style", "letter-spacing: 1px");
    title.setAttribute("data-source", "authored");
    const originalText = document.createTextNode("Make motion clear.");
    title.append(originalText);
    document.body.append(title);
    const selected = selection(title);
    const instance = createMotionInstance({
      presetId: "text.emphasis.highlight-sweep",
      target: { selector: "#title", elementId: "title" },
      targetKind: "text",
      start: 0,
    });
    const timeline = {
      to: vi.fn(),
      set: vi.fn(),
      play: vi.fn(),
      kill: vi.fn(),
    };
    timeline.to.mockReturnValue(timeline);
    timeline.set.mockReturnValue(timeline);
    Object.defineProperty(window, "gsap", {
      configurable: true,
      value: { timeline: vi.fn(() => timeline) },
    });

    const renderDraft = (parameters = instance.parameters) => (
      <AnimationPropertiesPanel
        draft={{
          templateId: "caption-highlight-word-sweep",
          presetId: instance.presetId,
          targetKind: instance.targetKind,
          applicationKind: "text",
          selection: selected,
          parameters,
        }}
        element={selected}
        animations={[]}
        onMutate={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    flushSync(() => root.render(renderDraft()));

    expect(title.querySelectorAll('[data-ipw-motion-role="unit"]')).toHaveLength(3);
    expect(title.querySelectorAll('[data-ipw-motion-role="background"]')).toHaveLength(3);
    expect(title.querySelectorAll('[data-ipw-motion-role="text"]')).toHaveLength(3);
    expect(timeline.to).toHaveBeenCalledTimes(4);
    expect(timeline.set).toHaveBeenCalledTimes(1);
    const [revealTargets, revealVars, revealPosition] = timeline.to.mock.calls[0];
    expect(revealTargets).toHaveLength(3);
    expect(revealPosition).toBe(0);
    expect(revealVars.duration).toBeCloseTo(0.505813953488, 12);
    expect(revealVars.stagger).toBeCloseTo(0.168604651163, 12);
    expect(revealVars).not.toHaveProperty("ease");
    expect(revealVars.keyframes["0%"].backgroundImage).toContain("linear-gradient");
    expect(revealVars.keyframes["100%"].ease).toBe("power2.out");
    const exitVars = timeline.to.mock.calls[1][1];
    expect(exitVars.duration).toBeCloseTo(0.337209302326, 12);
    expect(exitVars.stagger).toBeCloseTo(0.168604651163, 12);
    expect(exitVars).not.toHaveProperty("ease");
    expect(exitVars.keyframes["100%"].ease).toBe("power2.in");
    const [resetTargets, resetVars, resetPosition] = timeline.set.mock.calls[0];
    expect(resetTargets).toHaveLength(3);
    expect(resetPosition).toBeCloseTo(1.112790697674, 12);
    expect(resetVars.keyframes).toBeUndefined();
    expect(resetVars.scaleX).toBe(0);

    flushSync(() => root.render(renderDraft({ ...instance.parameters, intensity: 1.1 })));
    expect(title.querySelectorAll('[data-ipw-motion-role="unit"]')).toHaveLength(3);
    expect(
      title.querySelectorAll('[data-ipw-motion-role="unit"] [data-ipw-motion-role="unit"]'),
    ).toHaveLength(0);

    flushSync(() => root.render(<div />));
    expect(timeline.kill).toHaveBeenCalledTimes(2);
    expect(title.firstChild).toBe(originalText);
    expect(title.textContent).toBe("Make motion clear.");
    expect(title.getAttribute("style")).toBe("letter-spacing: 1px");
    expect(title.getAttribute("data-source")).toBe("authored");
    expect(title.hasAttribute("data-ipw-motion-structure")).toBe(false);
    title.remove();
  });

  it("leaves the DOM untouched when structured preview compilation rejects oversized text", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.setAttribute("style", "color: navy");
    const originalText = document.createTextNode("a".repeat(513));
    title.append(originalText);
    document.body.append(title);
    const selected = selection(title);
    const instance = createMotionInstance({
      presetId: "text.emphasis.highlight-sweep",
      target: { selector: "#title", elementId: "title" },
      targetKind: "text",
      start: 0,
      parameters: { unit: "character" },
    });
    const createTimeline = vi.fn();
    Object.defineProperty(window, "gsap", {
      configurable: true,
      value: { timeline: createTimeline },
    });

    expect(() =>
      flushSync(() =>
        root.render(
          <AnimationPropertiesPanel
            draft={{
              templateId: "caption-highlight-character-sweep",
              presetId: instance.presetId,
              targetKind: instance.targetKind,
              applicationKind: "text",
              selection: selected,
              parameters: instance.parameters,
            }}
            element={selected}
            animations={[]}
            onMutate={vi.fn()}
            onApplied={vi.fn()}
          />,
        ),
      ),
    ).not.toThrow();

    expect(createTimeline).not.toHaveBeenCalled();
    expect(title.firstChild).toBe(originalText);
    expect(title.textContent).toBe("a".repeat(513));
    expect(title.getAttribute("style")).toBe("color: navy");
    expect(title.hasAttribute("data-ipw-motion-structure")).toBe(false);
    title.remove();
  });

  it("does not replay a saved preview when only selection geometry refreshes", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    document.body.append(title);
    const timeline = {
      to: vi.fn(),
      play: vi.fn(),
      kill: vi.fn(),
    };
    timeline.to.mockReturnValue(timeline);
    const createTimeline = vi.fn(() => timeline);
    Object.defineProperty(window, "gsap", {
      configurable: true,
      value: { timeline: createTimeline },
    });
    const firstSelection = selection(title);
    const renderProperties = (selected: DomEditSelection) => (
      <AnimationPropertiesPanel
        draft={null}
        element={selected}
        animations={[semanticAnimation()]}
        onMutate={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    flushSync(() => root.render(renderProperties(firstSelection)));
    expect(createTimeline).toHaveBeenCalledOnce();

    flushSync(() =>
      root.render(
        renderProperties({
          ...selection(title),
          boundingBox: { x: 12, y: 8, width: 200, height: 40 },
        }),
      ),
    );

    expect(createTimeline).toHaveBeenCalledOnce();
    expect(timeline.kill).not.toHaveBeenCalled();
    title.remove();
  });

  it("keeps template selection out of the animation properties panel", () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    const onMutate = vi.fn();
    flushSync(() =>
      root.render(
        <SemanticMotionPanel element={selection(title)} animations={[]} onMutate={onMutate} />,
      ),
    );

    expect(container.textContent).toContain("请到“动画模板”中选择并应用一个模板");
    expect(container.textContent).not.toContain("浮入");
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("shows the same parameter-only empty state for a general element", () => {
    const card = document.createElement("div");
    card.id = "card";
    card.innerHTML = "<span>Nested content</span>";
    const onMutate = vi.fn();
    flushSync(() =>
      root.render(
        <SemanticMotionPanel element={selection(card)} animations={[]} onMutate={onMutate} />,
      ),
    );

    expect(container.textContent).toContain("请到“动画模板”中选择并应用一个模板");
    expect(container.textContent).not.toContain("滑入");
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("restores a saved semantic animation as an editable preset", async () => {
    const title = document.createElement("h1");
    title.id = "title";
    title.textContent = "Title";
    const animation = semanticAnimation();
    const onMutate = vi.fn();
    const { timeline } = installMotionPreviewTimeline();
    expect(resolveMotionInstances([animation])).toHaveLength(1);

    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(title)}
          animations={[animation]}
          onMutate={onMutate}
        />,
      ),
    );

    expect(container.textContent).toContain("浮入");
    expect(container.querySelector('button[aria-label="动画效果"]')).toBeNull();
    expect(container.textContent).toContain("时长");
    expect(container.textContent).toContain("速度");
    expect(container.textContent).toContain("出现");
    expect(container.textContent).toContain("动作");
    expect(container.textContent).toContain("消失");
    expect(container.textContent).toContain("速度曲线");
    expect(container.querySelector('[aria-label="开始时间"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="结束时间"]')).not.toBeNull();
    expect(container.querySelector('[role="switch"][aria-label="循环播放"]')).not.toBeNull();

    const preview = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("预览动画"),
    );
    if (!(preview instanceof HTMLButtonElement)) throw new Error("Preview action missing");
    preview.click();
    await vi.waitFor(() => expect(timeline.play).toHaveBeenCalledWith(0));
    expect(timeline.to.mock.calls[0]?.[0]).toBe(title);
    expect(onMutate).not.toHaveBeenCalled();

    const fast = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "快",
    );
    if (!(fast instanceof HTMLButtonElement)) throw new Error("Fast speed action missing");
    fast.click();
    expect(onMutate).toHaveBeenLastCalledWith("text", expect.objectContaining({ duration: 0.45 }));
  });

  it("uses the newest semantic preset when a legacy selector left a duplicate phase", () => {
    const card = document.createElement("div");
    card.id = "card";
    card.dataset.hfId = "hf-card";
    card.innerHTML = "<span>Nested card</span>";
    const makeAnimation = (presetId: string, selector: string, id: string): GsapAnimation => {
      const compiled = compileMotionInstance(
        createMotionInstance({
          presetId,
          target: { selector, elementId: "card", hfId: "hf-card" },
          targetKind: "element",
          start: 1,
        }),
      );
      return {
        id,
        targetSelector: compiled.targetSelector,
        method: "to",
        position: compiled.position,
        resolvedStart: compiled.position,
        duration: compiled.duration,
        properties: {},
        extras: compiled.extras,
      };
    };

    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(card)}
          animations={[
            makeAnimation("element.emphasis.lift", ".card", "legacy-lift"),
            makeAnimation(
              "motion.emphasis.soft-float",
              '[data-hf-id="hf-card"]',
              "current-soft-float",
            ),
          ]}
          onMutate={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("柔和漂浮");
    expect(container.textContent).not.toContain("浮起");
  });

  it("repairs a legacy out-of-range animation before previewing it", async () => {
    const clip = document.createElement("section");
    clip.className = "clip";
    clip.dataset.start = "15.6";
    clip.dataset.duration = "3";
    const card = document.createElement("div");
    card.id = "card";
    card.innerHTML = "<span>Nested card</span>";
    clip.append(card);
    document.body.append(clip);
    const instance = createMotionInstance({
      presetId: "element.emphasis.lift",
      target: { selector: "#card", elementId: "card" },
      targetKind: "element",
      start: 0.1,
      duration: 0.8,
    });
    const compiled = compileMotionInstance(instance);
    const animation: GsapAnimation = {
      id: "stale-lift",
      targetSelector: compiled.targetSelector,
      method: "to",
      position: compiled.position,
      resolvedStart: 16.7,
      duration: compiled.duration,
      properties: {},
      extras: compiled.extras,
    };
    const onMutate = vi.fn(async () => true);
    const { timeline } = installMotionPreviewTimeline();

    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(card)}
          animations={[animation]}
          onMutate={onMutate}
        />,
      ),
    );

    const preview = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("预览动画"),
    );
    if (!(preview instanceof HTMLButtonElement)) throw new Error("Preview action missing");
    preview.click();

    await vi.waitFor(() => {
      expect(onMutate).toHaveBeenCalledWith(
        "element",
        expect.objectContaining({
          operation: "upsert",
          presetId: "element.emphasis.lift",
          start: 16.7,
          duration: 0.8,
        }),
      );
      expect(timeline.play).toHaveBeenCalledWith(0);
      expect(timeline.to.mock.calls[0]?.[0]).toBe(card);
    });
    clip.remove();
  });

  it("opens the applied background template phase and exposes its parameters", () => {
    const background = document.createElement("div");
    background.id = "background";
    background.innerHTML = "<span>Nested surface content</span>";
    const compiled = compileMotionInstance(
      createMotionInstance({
        presetId: "background.emphasis.molten-flow",
        target: { selector: "#background", elementId: "background" },
        targetKind: "element",
        start: 0,
      }),
    );
    const animation: GsapAnimation = {
      id: "background-motion",
      targetSelector: compiled.targetSelector,
      method: "to",
      position: compiled.position,
      resolvedStart: compiled.position,
      duration: compiled.duration,
      properties: {},
      extras: compiled.extras,
    };

    flushSync(() =>
      root.render(
        <SemanticMotionPanel
          element={selection(background)}
          animations={[animation]}
          onMutate={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("熔光流动");
    expect(container.textContent).toContain("颜色来源");
    expect(container.querySelectorAll('button[data-flat-color-value-trigger="true"]')).toHaveLength(
      3,
    );
    expect(container.textContent).toContain("亮度");
    expect(container.textContent).not.toContain("当前阶段还没有动画");
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
