// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { ensureElementAddressable } from "./gsapScriptCommitHelpers";
import { commitGsapPositionFromDrag } from "./gsapDragPositionCommit";
import type { GsapDragCommitCallbacks } from "./gsapDragCommit";
import { usePlayerStore } from "../player/store/playerStore";

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

describe("ensureElementAddressable", () => {
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

describe("GSAP drag position commits", () => {
  test("uses the refreshed animation id after converting an effect from-tween", async () => {
    const element = document.createElement("section");
    element.className = "card";
    const selection = createSelection(element, {
      selector: ".card",
      sourceFile: "compositions/effects/effect-ending-douyin-follow.html",
      compositionPath: "compositions/effects/effect-ending-douyin-follow.html",
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
