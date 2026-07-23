import { describe, expect, it } from "vitest";
import { resolveEffectStackSelectionTarget } from "./studioPreviewHelpers";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function element(input: {
  text: string;
  position?: string;
  pointerEvents?: string;
  box?: DOMRect;
}): HTMLElement {
  const result = {
    textContent: input.text,
    getBoundingClientRect: () => input.box ?? rect(0, 0, 100, 30),
  } as unknown as HTMLElement;
  Object.assign(result, {
    nodeType: 1,
    style: {},
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          position: input.position ?? "static",
          pointerEvents: input.pointerEvents ?? "auto",
        }),
      },
    },
  });
  return result;
}

describe("resolveEffectStackSelectionTarget", () => {
  it("promotes duplicate visual text layers to their shared parent", () => {
    const parent = { children: [] } as unknown as HTMLElement;
    const base = element({ text: "AI相关技术", box: rect(100, 80, 300, 90) });
    const cyan = element({
      text: "AI相关技术",
      position: "absolute",
      pointerEvents: "none",
      box: rect(98, 80, 300, 90),
    });
    const magenta = element({
      text: "AI相关技术",
      position: "absolute",
      pointerEvents: "none",
      box: rect(102, 80, 300, 90),
    });
    Object.assign(parent, { children: [base, cyan, magenta] });
    Object.assign(base, { parentElement: parent });
    Object.assign(cyan, { parentElement: parent });
    Object.assign(magenta, { parentElement: parent });

    expect(resolveEffectStackSelectionTarget(base)).toBe(parent);
    expect(resolveEffectStackSelectionTarget(cyan)).toBe(parent);
  });

  it("leaves ordinary repeated text elements independently selectable", () => {
    const parent = { children: [] } as unknown as HTMLElement;
    const first = element({ text: "Repeated", box: rect(0, 0, 100, 30) });
    const second = element({ text: "Repeated", box: rect(0, 80, 100, 30) });
    Object.assign(parent, { children: [first, second] });
    Object.assign(first, { parentElement: parent });
    Object.assign(second, { parentElement: parent });

    expect(resolveEffectStackSelectionTarget(first)).toBe(first);
  });
});
