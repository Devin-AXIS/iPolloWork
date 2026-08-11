// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { ensureElementAddressable } from "./gsapScriptCommitHelpers";

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
