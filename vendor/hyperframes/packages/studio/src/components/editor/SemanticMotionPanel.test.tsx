// @vitest-environment happy-dom
import { PropertyKeyframeRows } from "./AnimationCardParts";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { compileMotionInstance, createMotionInstance } from "@hyperframes/core/motion-presets";
import { findElementForSelection, type DomEditSelection } from "./domEditing";
import { collectDomEditTextFields, resolveDomEditSelection } from "./domEditingLayers";
import {
  resolveMotionInstances,
  resolveMotionTargetKind,
  SemanticMotionPanel,
} from "./SemanticMotionPanel";
import { patchRuntimeTweenInPlace } from "../../hooks/gsapRuntimePatch";
import { usePlayerStore } from "../../player/store/playerStore";

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({previewIframeRef:{current:null},showToast:vi.fn()}),
}));

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
      button.textContent?.includes("在时间轴中定位"),
    );
    if (!(preview instanceof HTMLButtonElement)) throw new Error("Preview action missing");
    preview.click();
    expect(timeline.play).not.toHaveBeenCalled();
    expect(timeline.to).not.toHaveBeenCalled();
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

  it("locates a legacy out-of-range animation without rewriting or regenerating it", async () => {
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
      button.textContent?.includes("在时间轴中定位"),
    );
    if (!(preview instanceof HTMLButtonElement)) throw new Error("Preview action missing");
    preview.click();

    expect(onMutate).not.toHaveBeenCalled();
    expect(timeline.play).not.toHaveBeenCalled();
    expect(timeline.to).not.toHaveBeenCalled();
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

  it("groups split semantic channels and links the exact selected property using user units", () => {
    const title=document.createElement("h1");title.id="title";title.textContent="Title";
    const compiled=compileMotionInstance(createMotionInstance({presetId:"text.enter.rise",target:{selector:"#title",elementId:"title"},targetKind:"text",start:1,duration:1}));
    const base={...semanticAnimation(),position:1,resolvedStart:1,duration:1,extras:compiled.extras};
    const position: GsapAnimation={...base,id:"position-split",keyframes:{format:"percentage",keyframes:compiled.keyframes.map((key) => ({...key,properties:{y:key.properties.y ?? 0}}))}};
    const opacity: GsapAnimation={...base,id:"opacity-split",keyframes:{format:"percentage",keyframes:[{percentage:0,properties:{opacity:0}},{percentage:100,properties:{opacity:0.8,data:"hf-manual-keyframe"}}]}};
    usePlayerStore.setState({selectedElementId:"title"});
    usePlayerStore.getState().setSelectedPropertyKeyframe({ownerKey:"title",animationId:"position-split",property:"opacity",time:2});
    const onMutate=vi.fn(async () => true);const onEdit=vi.fn();
    flushSync(() => root.render(<SemanticMotionPanel compact element={selection(title)} animations={[position,opacity]} onMutate={onMutate} onEditPropertyKeyframe={onEdit} />));
    expect(container.querySelectorAll("[data-semantic-motion-id]")).toHaveLength(1);
    expect(container.querySelector('[data-semantic-motion-id][data-selected="true"]')?.getAttribute("data-animation-id")).toBe("opacity-split");
    expect(container.querySelector('[data-layer-effect-property="opacity"][data-selected="true"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('[aria-label="opacity keyframe value at 100%"]')?.value).toBe("80");
    expect(container.querySelector('[data-layer-effect-property="data"]')).toBeNull();
    expect(container.querySelector('[data-testid="manual-motion-preserved"]')).not.toBeNull();
    expect(onMutate).not.toHaveBeenCalled();expect(onEdit).not.toHaveBeenCalled();
    const parameters = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Template parameters");
    if (!parameters) throw new Error("Template parameters action missing");
    flushSync(() => parameters.click());
    const sliders=Array.from(container.querySelectorAll('[role="slider"]'));
    expect(sliders.length).toBeGreaterThan(0);
    for (const slider of sliders) {
      expect(slider.getAttribute("aria-disabled")).toBe("true");
      const capture=vi.fn();
      Object.defineProperty(slider,"setPointerCapture",{value:capture});
      slider.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:100,pointerId:1}));
      slider.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:150,pointerId:1}));
      slider.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:150,pointerId:1}));
      slider.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
      expect(capture).not.toHaveBeenCalled();
    }
    expect(onMutate).not.toHaveBeenCalled();
    const continueEditing=container.querySelector('[data-testid="continue-manual-keyframes"]');
    if (!(continueEditing instanceof HTMLButtonElement)) throw new Error("Manual editing action missing");
    const selectedBefore=usePlayerStore.getState().selectedPropertyKeyframe;
    continueEditing.click();
    expect(usePlayerStore.getState().selectedPropertyKeyframe).toEqual(selectedBefore);
    expect(usePlayerStore.getState().clipRevealRequest?.elementId).toBe("title");
    const locate=container.querySelector('[aria-label="Locate effect in timeline"]');
    if (!(locate instanceof HTMLButtonElement)) throw new Error("Effect locate action missing");
    locate.click();
    expect(usePlayerStore.getState().requestedSeekTime).toBe(1);
    expect(usePlayerStore.getState().clipRevealRequest?.elementId).toBe("title");
    expect(onMutate).not.toHaveBeenCalled();expect(onEdit).not.toHaveBeenCalled();
  });
  it("compact string channels show authored values read-only when runtime values are unavailable", () => {
    const animation: GsapAnimation = {id:"filter",targetSelector:"#title",method:"to",position:1,duration:1,properties:{},keyframes:{format:"percentage",keyframes:[{percentage:0,properties:{filter:"blur(0px)"}},{percentage:100,properties:{filter:"blur(8px)"}}]}};
    usePlayerStore.setState({selectedElementId:"title",selectedPropertyKeyframe:null,currentTime:2});
    const edit=vi.fn();
    flushSync(() => root.render(<PropertyKeyframeRows compact ownerKey="title" animation={animation} onEdit={edit} />));
    const input=container.querySelector<HTMLInputElement>('[data-layer-effect-property="filter"] input');
    expect(input?.value).toBe("blur(8px)");
    expect(input?.disabled).toBe(true);
    expect(input?.parentElement?.title).toBe("blur(8px)");
    expect(edit).not.toHaveBeenCalled();
  });

});
