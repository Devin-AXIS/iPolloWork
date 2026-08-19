// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { orientedOverlayRect } from "./domEditOverlayGeometry";
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

describe("composition-host edit coordinates", () => {
  it("moves a selected sub-composition host in parent coordinates", () => {
    const overlay = document.createElement("div");
    const iframe = document.createElement("iframe");
    document.body.append(overlay, iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = `
      <main data-composition-id="master" data-width="1000" data-height="500">
        <div id="ending" data-composition-src="compositions/effects/effect-ending-demo.html"
          data-width="1920" data-height="1080"></div>
      </main>
    `;
    const host = doc.getElementById("ending") as HTMLElement;
    Object.defineProperty(overlay, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 500, height: 250 }),
    });
    Object.defineProperty(iframe, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 500, height: 250 }),
    });
    Object.defineProperty(host, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 50, width: 400, height: 225 }),
    });

    const rect = orientedOverlayRect(overlay, iframe, host);
    expect(rect?.editScaleX).toBe(0.5);
    expect(rect?.editScaleY).toBe(0.5);
  });
});
