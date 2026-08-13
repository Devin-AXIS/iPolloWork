// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { shouldMeasureDomEditChildRect } from "./useDomEditOverlayRects";

describe("shouldMeasureDomEditChildRect", () => {
  it("hides structured text motion internals from selection child chrome", () => {
    const root = document.createElement("h1");
    root.setAttribute("data-ipw-motion-structure", "v1");
    root.innerHTML = `
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">Duty,</span>
      </span>
      <span data-ipw-motion-role="unit" data-ipw-motion-word="">
        <span data-ipw-motion-role="background" aria-hidden="true"></span>
        <span data-ipw-motion-role="text">not</span>
      </span>
    `;

    const generatedChildren = Array.from(
      root.querySelectorAll<HTMLElement>("[data-ipw-motion-role]"),
    );
    expect(generatedChildren).toHaveLength(6);
    expect(generatedChildren.map((child) => shouldMeasureDomEditChildRect(root, child))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("hides legacy split motion internals from selection child chrome", () => {
    const root = document.createElement("h1");
    root.setAttribute("data-ipw-motion-split", "v1");
    root.innerHTML = `
      <span data-ipw-motion-word="">
        <span data-ipw-motion-char="">M</span>
      </span>
    `;

    const generatedChildren = Array.from(root.querySelectorAll<HTMLElement>("span"));
    expect(generatedChildren.map((child) => shouldMeasureDomEditChildRect(root, child))).toEqual([
      false,
      false,
    ]);
  });

  it("keeps authored child boxes visible for normal selected containers", () => {
    const root = document.createElement("div");
    const child = document.createElement("span");
    child.textContent = "Authored detail";
    root.appendChild(child);

    expect(shouldMeasureDomEditChildRect(root, child)).toBe(true);
  });
});
