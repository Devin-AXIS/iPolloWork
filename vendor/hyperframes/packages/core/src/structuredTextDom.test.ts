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
  recipeId: "caption.highlight",
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

  it("keeps decorative layers empty so textContent is never duplicated", () => {
    const target = document.createElement("div");
    target.textContent = "Make motion clear.";
    const compiled = highlight(target.textContent);
    compiled.layers.splice(2, 0, { role: "clone-primary", perUnit: true, className: "ipw-motion-clone" });

    materializeStructuredText(target, compiled);

    expect(target.textContent).toBe("Make motion clear.");
    expect(target.querySelector('[data-ipw-motion-role="clone-primary"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(target.querySelector('[data-ipw-motion-role="clone-primary"]')?.textContent).toBe("");
  });
});
