// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FillModeSelector } from "./propertyPanelFlatStyleSections";

describe("FillModeSelector", () => {
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
  });

  it("uses the selected Figma asset and reports a fill mode change", () => {
    const onChange = vi.fn();
    flushSync(() =>
      root.render(<FillModeSelector value="Solid" disabled={false} onChange={onChange} />),
    );

    const solid = container.querySelector('[aria-label="Solid color"]');
    const gradient = container.querySelector('[aria-label="Gradient"]');
    if (!(solid instanceof HTMLButtonElement) || !(gradient instanceof HTMLButtonElement)) {
      throw new Error("Fill controls were not rendered");
    }

    expect(solid.getAttribute("aria-pressed")).toBe("true");
    const solidIcon = solid.querySelector("img")?.getAttribute("src") ?? "";
    const gradientIcon = gradient.querySelector("img")?.getAttribute("src") ?? "";
    expect(decodeURIComponent(solidIcon)).toContain("fill='white'");
    expect(decodeURIComponent(gradientIcon)).toContain("stroke='#858A94'");
    expect(gradient.getAttribute("aria-pressed")).toBe("false");

    gradient.click();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("Gradient");
  });

  it("disables all fill controls and suppresses interaction", () => {
    const onChange = vi.fn();
    flushSync(() => root.render(<FillModeSelector value="None" disabled onChange={onChange} />));

    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);

    buttons[1]?.click();
    expect(onChange).not.toHaveBeenCalled();
  });
});
