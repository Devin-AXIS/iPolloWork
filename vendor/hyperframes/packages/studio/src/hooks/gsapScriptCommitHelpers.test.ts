// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { ensureElementAddressable } from "./gsapScriptCommitHelpers";
import { commitGsapPositionFromDrag } from "./gsapDragPositionCommit";
import type { GsapDragCommitCallbacks } from "./gsapDragCommit";
import { shouldCommitAnimationKeyframe, usePlayerStore } from "../player/store/playerStore";
import { selectorFromSelection } from "./gsapShared";
import { isolateSharedAnimationTargets, tryGsapDragIntercept } from "./gsapRuntimeBridge";
import { buildExtendedKeyframes, keyframeAtPlayhead } from "./useEnableKeyframes";

function createSelection(
  element: HTMLElement,
  overrides: Partial<DomEditSelection> = {},
): DomEditSelection {
  return {
    element,
    label: "Selected element",
    tagName: element.tagName.toLowerCase(),
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    textContent: element.textContent,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
    ...overrides,
  };
}

test("conversion without the requested point cannot report a successful manual capture", () => {
  const selection = createSelection(document.createElement("div"));
  const converted: GsapAnimation = {
    id: "title-position", targetSelector: "#title", method: "to", position: 2,
    duration: 3, properties: {}, keyframes: {
      format: "percentage", keyframes: [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 100, properties: { x: 120 } },
      ],
    },
  };
  expect(keyframeAtPlayhead(converted, selection, 3.5)).toBeUndefined();
  const point = { percentage: 50, properties: { x: 105, data: "hf-manual-keyframe" } };
  converted.keyframes?.keyframes.push(point);
  expect(keyframeAtPlayhead(converted, selection, 3.5)).toBe(point);
});

describe("ensureElementAddressable", () => {
  test("prefers a stable hf id over a selector shared by siblings", () => {
    document.body.innerHTML = '<div class="card" data-hf-id="card-two"></div>';
    const element = document.querySelector<HTMLElement>(".card");
    expect(element).not.toBeNull();
    if (!element) return;

    expect(
      selectorFromSelection(
        createSelection(element, { hfId: "card-two", selector: ".card", selectorIndex: 1 }),
      ),
    ).toBe('[data-hf-id="card-two"]');
  });

  test("assigns an auto id when a selector matches multiple elements", () => {
    document.body.innerHTML = "<h1>First</h1><h1>Second</h1><h1>Third</h1>";
    const element = document.querySelectorAll("h1").item(1) as HTMLElement | null;
    expect(element).not.toBeNull();
    if (!element) return;

    const result = ensureElementAddressable(
      createSelection(element, {
        selector: "h1",
        selectorIndex: 1,
      }),
    );

    expect(result).toEqual({ selector: "#h1", autoId: "h1" });
    expect(element.id).toBe("h1");
  });

  test("uses a stable hf id instead of a selector shared by sibling elements", () => {
    document.body.innerHTML = `
      <span class="task-label" data-hf-id="hf-first">First</span>
      <span class="task-label" data-hf-id="hf-selected">Selected</span>
      <span class="task-label" data-hf-id="hf-third">Third</span>
    `;
    const element = document.querySelector<HTMLElement>('[data-hf-id="hf-selected"]');
    expect(element).not.toBeNull();
    if (!element) return;

    const result = ensureElementAddressable(
      createSelection(element, {
        hfId: "hf-selected",
        selector: ".task-label",
        selectorIndex: 1,
      }),
    );

    expect(result).toEqual({ selector: '[data-hf-id="hf-selected"]' });
    expect(document.querySelectorAll(result.selector)).toHaveLength(1);
  });

  test("keeps an authored element id as the primary animation target", () => {
    const element = document.createElement("span");
    element.id = "focused-ownership";
    element.setAttribute("data-hf-id", "hf-focused");

    expect(
      ensureElementAddressable(
        createSelection(element, {
          id: "focused-ownership",
          hfId: "hf-focused",
          selector: ".task-label",
        }),
      ),
    ).toEqual({ selector: "#focused-ownership" });
  });
});

describe("manual animation edit policy", () => {
  test("does not create implicit playhead keyframes by default", () => {
    expect(shouldCommitAnimationKeyframe(null)).toBe(false);
  });

  test("still edits an explicitly selected keyframe", () => {
    expect(shouldCommitAnimationKeyframe(0)).toBe(true);
    expect(shouldCommitAnimationKeyframe(50)).toBe(true);
    expect(shouldCommitAnimationKeyframe(100)).toBe(true);
  });

  test("plain drag shifts every position keyframe instead of writing one transient frame", async () => {
    document.body.innerHTML = '<div data-hf-id="card-two"></div>';
    const element = document.querySelector<HTMLElement>('[data-hf-id="card-two"]');
    expect(element).not.toBeNull();
    if (!element) return;
    const selection = createSelection(element, {
      hfId: "card-two",
      selector: '[data-hf-id="card-two"]',
    });
    const animation: GsapAnimation = {
      id: "card-position",
      targetSelector: '[data-hf-id="card-two"]',
      method: "to",
      position: 0,
      duration: 1,
      propertyGroup: "position",
      properties: {},
      keyframes: {
        format: "percentage",
        keyframes: [
          { percentage: 0, properties: { x: 0, y: 0 } },
          { percentage: 100, properties: { x: 100, y: 50 } },
        ],
      },
    };
    const mutations: Record<string, unknown>[] = [];
    usePlayerStore.getState().setActiveKeyframePct(null);

    const handled = await tryGsapDragIntercept(
      selection,
      { x: 40, y: 20 },
      [animation],
      null,
      async (_selection, mutation) => {
        mutations.push(mutation);
      },
    );

    expect(handled).toBe(true);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toEqual({
      type: "offset-position-paths",
      targetSelector: '[data-hf-id="card-two"]',
      deltaX: 40,
      deltaY: 20,
    });

    // An explicitly selected point remains editable, without arming future edits.
    usePlayerStore.getState().setActiveKeyframePct(50);
    const commit = async (_selection: DomEditSelection, mutation: Record<string, unknown>) => {
      mutations.push(mutation);
    };
    await tryGsapDragIntercept(selection, { x: 40, y: 20 }, [animation], null, commit);
    expect(mutations[1]).toMatchObject({
      type: "add-keyframe", animationId: "card-position", percentage: 50,
    });
    expect(usePlayerStore.getState().activeKeyframePct).toBeNull();
    await tryGsapDragIntercept(selection, { x: 40, y: 20 }, [animation], null, commit);
    expect(mutations[2]).toMatchObject({ type: "offset-position-paths" });
  });
});

describe("shared GSAP target isolation", () => {
  test("retargets a shared class before editing one selected element", async () => {
    document.body.innerHTML = `
      <div class="card" data-hf-id="card-one"></div>
      <div class="card" data-hf-id="card-two"></div>
      <div class="card" data-hf-id="card-three"></div>
    `;
    const element = document.querySelector<HTMLElement>('[data-hf-id="card-two"]');
    expect(element).not.toBeNull();
    if (!element) return;
    const selection = createSelection(element, { hfId: "card-two", selector: ".card" });
    const sharedAnimation = {
      id: "shared-position",
      targetSelector: ".card",
      method: "to",
      position: 0,
      duration: 1,
      properties: { x: 80 },
      propertyGroup: "position",
    } as GsapAnimation;
    const selectedAnimation = {
      ...sharedAnimation,
      id: "selected-position",
      targetSelector: '[data-hf-id="card-two"]',
    };
    const mutations: Record<string, unknown>[] = [];

    const result = await isolateSharedAnimationTargets(
      selection,
      [sharedAnimation],
      async (_selection, mutation) => {
        mutations.push(mutation);
      },
      async () => [selectedAnimation],
    );

    expect(mutations).toEqual([
      {
        type: "isolate-selector-target",
        targetSelector: ".card",
        selectedSelector: '[data-hf-id="card-two"]',
        remainderSelector: ':is(.card):not([data-hf-id="card-two"])',
      },
    ]);
    expect(result.animations).toEqual([selectedAnimation]);
    expect(result.isolated).toBe(true);
  });

  test("forces the first edit after isolation to rebuild the GSAP runtime", async () => {
    document.body.innerHTML = `
      <div class="card" data-hf-id="card-one"></div>
      <div class="card" data-hf-id="card-two"></div>
    `;
    const element = document.querySelector<HTMLElement>('[data-hf-id="card-two"]');
    expect(element).not.toBeNull();
    if (!element) return;
    const selection = createSelection(element, { hfId: "card-two", selector: ".card" });
    const sharedAnimation = {
      id: "shared-position",
      targetSelector: ".card",
      method: "set",
      position: 0,
      duration: 0,
      properties: { x: 0, y: 0 },
      propertyGroup: "position",
    } as GsapAnimation;
    const forwardedOptions: Array<Record<string, unknown>> = [];
    const result = await isolateSharedAnimationTargets(
      selection,
      [sharedAnimation],
      async (_selection, _mutation, options) => {
        forwardedOptions.push(options);
      },
      async () => [
        {
          ...sharedAnimation,
          id: "selected-position",
          targetSelector: '[data-hf-id="card-two"]',
        },
      ],
    );

    await result.commitMutation(
      selection,
      { type: "update-properties", animationId: "selected-position", properties: { x: 40 } },
      {
        label: "Move layer",
        softReload: true,
        instantPatch: {
          selector: '[data-hf-id="card-two"]',
          change: { kind: "set", props: { x: 40 } },
        },
      },
    );

    expect(forwardedOptions).toHaveLength(2);
    expect(forwardedOptions[1]).toMatchObject({ label: "Move layer", softReload: true });
    expect(forwardedOptions[1]).not.toHaveProperty("instantPatch");
  });
});

describe("GSAP drag position commits", () => {
  test("uses the refreshed animation id after converting a component from-tween", async () => {
    const element = document.createElement("section");
    element.className = "card";
    const selection = createSelection(element, {
      selector: ".card",
      sourceFile: "compositions/components/route-map.html",
      compositionPath: "compositions/components/route-map.html",
      dataAttributes: { start: "0", duration: "3.2" },
    });
    const originalAnimation: GsapAnimation = {
      id: "card-from-0",
      targetSelector: ".card",
      method: "from",
      position: 0,
      duration: 0.72,
      propertyGroup: "position",
      properties: { y: 90 },
    };
    const convertedAnimation: GsapAnimation = {
      ...originalAnimation,
      id: "card-keyframes-0",
      method: "to",
      keyframes: {
        format: "percentage",
        keyframes: [
          { percentage: 0, properties: { x: 0, y: 90 } },
          { percentage: 100, properties: { x: 0, y: 0 } },
        ],
      },
    };
    const mutations: Record<string, unknown>[] = [];
    const commitMutation: GsapDragCommitCallbacks["commitMutation"] = async (
      _selection,
      mutation,
    ) => {
      mutations.push(mutation);
    };
    usePlayerStore.getState().setActiveKeyframePct(null);
    usePlayerStore.getState().setCurrentTime(0.36);

    await commitGsapPositionFromDrag(
      selection,
      originalAnimation,
      { x: 40, y: 20 },
      { x: 0, y: 0 },
      null,
      ".card",
      {
        commitMutation,
        fetchAnimations: async () => [convertedAnimation],
      },
    );

    expect(mutations).toHaveLength(2);
    expect(mutations[0]).toMatchObject({
      type: "convert-to-keyframes",
      animationId: originalAnimation.id,
    });
    expect(mutations[1]).toMatchObject({
      type: "add-keyframe",
      animationId: convertedAnimation.id,
    });
  });
});

test("extending a converted tween preserves its existing segment time, properties and easing", () => {
  const anim: GsapAnimation = {
    id: "card", targetSelector: "#card", method: "to", position: 0.16,
    duration: 0.55, ease: "none", properties: {},
    keyframes: {
      format: "percentage", easeEach: "power3.out",
      keyframes: [
        { percentage: 0, properties: { scale: 0.985, opacity: 0 } },
        { percentage: 100, properties: { scale: 1, opacity: 1 }, ease: "power2.out" },
      ],
    },
  };
  const result = buildExtendedKeyframes(anim, 4, { scale: 1, opacity: 1 });
  expect(result.position).toBe(0.16);
  expect(result.duration).toBe(3.84);
  const endpoint = result.keyframes[1];
  expect(result.position + endpoint.percentage / 100 * result.duration).toBeCloseTo(0.71, 7);
  expect(endpoint).toMatchObject({ properties: { scale: 1, opacity: 1 }, ease: "power2.out" });
});
