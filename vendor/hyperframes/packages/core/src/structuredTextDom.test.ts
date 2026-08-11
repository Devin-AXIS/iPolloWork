// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { CompiledStructuredTextMotion } from "./structuredTextMotion.js";
import {
  materializeStructuredText,
  restoreStructuredText,
  snapshotStructuredText,
  unwrapStructuredText,
} from "./motionPresets.js";

const highlight = (text: string): CompiledStructuredTextMotion => ({
  version: 1,
  recipeId: "caption-highlight.word-sweep",
  split: "word",
  units: ["Make", "motion", "clear"].map((sourceText, index) => ({ index, sourceText })),
  layers: [
    { role: "unit", perUnit: true, className: "ipw-motion-unit" },
    { role: "background", perUnit: true, className: "ipw-motion-background" },
    { role: "text", perUnit: true, className: "ipw-motion-text" },
  ],
  tracks: [],
  seed: 1,
});

afterEach(() => document.body.replaceChildren());

describe("structured text DOM", () => {
  it("materializes Highlight as reversible word/background/text layers", () => {
    const target = document.createElement("div");
    const before = document.createElement("em");
    before.textContent = "Make";
    const source = document.createTextNode(" motion ");
    const after = document.createElement("strong");
    after.textContent = "clear.\n";
    target.append(before, source, after);
    document.body.append(target);
    const snapshot = snapshotStructuredText(target);

    materializeStructuredText(target, highlight(target.textContent ?? ""));

    const units = target.querySelectorAll('[data-ipw-motion-role="unit"]');
    expect(units).toHaveLength(3);
    expect(units[2]?.querySelector('[data-ipw-motion-role="text"]')?.textContent).toBe("clear.");
    expect(Array.from(target.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent))
      .toEqual([" ", " ", "\n"]);
    expect(units[0]?.getAttribute("data-ipw-motion-word")).toBe("");
    expect(units[0]?.querySelector('[data-ipw-motion-role="background"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(units[0]?.querySelector('[data-ipw-motion-role="background"]')?.textContent).toBe("");
    expect(units[0]?.querySelector('[data-ipw-motion-role="text"]')?.textContent).toBe("Make");
    expect((units[0] as HTMLElement).style.position).toBe("relative");
    expect((units[0] as HTMLElement).style.padding).toBe("0.075em 0.15em 0.1em");
    expect((units[0] as HTMLElement).style.lineHeight).toBe("1");
    expect((units[0]?.querySelector('[data-ipw-motion-role="background"]') as HTMLElement).style.position).toBe("absolute");
    expect((units[0]?.querySelector('[data-ipw-motion-role="text"]') as HTMLElement).style.zIndex).toBe("1");
    expect(target.getAttribute("data-ipw-motion-structure")).toBe("v1");
    expect(target.getAttribute("data-ipw-motion-source")).toBeTruthy();

    restoreStructuredText(target, snapshot);

    expect(target.firstChild).toBe(before);
    expect(target.childNodes[1]).toBe(source);
    expect(target.lastChild).toBe(after);
    expect(target.textContent).toBe("Make motion clear.\n");
    expect(target.hasAttribute("data-ipw-motion-structure")).toBe(false);
  });

  it("does not nest wrappers and unwraps to the exact source text", () => {
    const target = document.createElement("div");
    target.textContent = "Make motion clear.\n";

    materializeStructuredText(target, highlight(target.textContent ?? ""));
    materializeStructuredText(target, highlight(target.textContent ?? ""));

    expect(target.querySelectorAll('[data-ipw-motion-role="unit"]')).toHaveLength(3);
    expect(target.querySelectorAll('[data-ipw-motion-role="unit"] [data-ipw-motion-role="unit"]')).toHaveLength(0);
    unwrapStructuredText(target);
    expect(target.textContent).toBe("Make motion clear.\n");
    expect(target.childNodes).toHaveLength(1);
    expect(target.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(target.hasAttribute("data-ipw-motion-source")).toBe(false);
  });

  it("uses split-specific compatibility markers", () => {
    const cases = [
      { split: "word" as const, unit: "Motion", marker: "data-ipw-motion-word" },
      { split: "character" as const, unit: "M", marker: "data-ipw-motion-char" },
      { split: "whole" as const, unit: "Motion", marker: undefined },
    ];

    for (const testCase of cases) {
      const target = document.createElement("div");
      target.textContent = "Motion";
      const compiled = highlight(target.textContent);
      compiled.split = testCase.split;
      compiled.units = [{ index: 0, sourceText: testCase.unit }];

      materializeStructuredText(target, compiled);

      const unit = target.querySelector('[data-ipw-motion-role="unit"]');
      expect(unit?.hasAttribute("data-ipw-motion-word")).toBe(testCase.marker === "data-ipw-motion-word");
      expect(unit?.hasAttribute("data-ipw-motion-char")).toBe(testCase.marker === "data-ipw-motion-char");
    }
  });

  it("materializes readable clone and particle layers without losing the source marker", () => {
    const target = document.createElement("div");
    target.textContent = "Make motion clear.";
    const compiled = highlight(target.textContent);
    compiled.layers.splice(
      2,
      0,
      { role: "clone-primary", perUnit: true, className: "ipw-motion-clone-primary" },
      { role: "clone-accent", perUnit: true, className: "ipw-motion-clone-accent" },
      { role: "particle-container", perUnit: true, className: "ipw-motion-particles" },
    );
    compiled.particles = [{ unitIndex: 1, x: 12.5, y: -4, size: 6, delay: 0.2 }];

    materializeStructuredText(target, compiled);

    const units = target.querySelectorAll('[data-ipw-motion-role="unit"]');
    expect(units[0]?.querySelector('[data-ipw-motion-role="clone-primary"]')?.textContent).toBe("Make");
    expect(units[0]?.querySelector('[data-ipw-motion-role="clone-accent"]')?.textContent).toBe("Make");
    expect(units[0]?.querySelector('[data-ipw-motion-role="clone-primary"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(units[0]?.querySelector('[data-ipw-motion-role="clone-accent"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(units[0]?.querySelector('[data-ipw-motion-role="particle"]')).toBeNull();
    const particle = units[1]?.querySelector('[data-ipw-motion-role="particle"]') as HTMLElement;
    expect(particle.parentElement?.getAttribute("data-ipw-motion-role")).toBe("particle-container");
    expect(particle.getAttribute("aria-hidden")).toBe("true");
    expect(particle.dataset.ipwMotionParticleX).toBe("12.5");
    expect(particle.dataset.ipwMotionParticleY).toBe("-4");
    expect(particle.dataset.ipwMotionParticleSize).toBe("6");
    expect(particle.dataset.ipwMotionParticleDelay).toBe("0.2");
    expect(particle.style.left).toBe("12.5px");
    expect(particle.style.top).toBe("-4px");
    expect(particle.style.width).toBe("6px");
    expect(particle.style.height).toBe("6px");
    expect(particle.style.animationDelay).toBe("0.2s");

    const originalMarker = target.getAttribute("data-ipw-motion-source");
    materializeStructuredText(target, compiled, target.textContent ?? "");
    expect(target.getAttribute("data-ipw-motion-source")).toBe(originalMarker);
    unwrapStructuredText(target);
    expect(target.textContent).toBe("Make motion clear.");
  });
});
