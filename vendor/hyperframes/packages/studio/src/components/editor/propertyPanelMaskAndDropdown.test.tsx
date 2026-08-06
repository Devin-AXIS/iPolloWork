// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMaskGeometry, inferMaskShape, parseMaskGeometry } from "./clipPathHelpers";
import { FlatRow } from "./propertyPanelFlatPrimitives";
import { FlatDropdown } from "./propertyPanelFlatSelectRow";

describe("FlatDropdown", () => {
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

  it("opens a Design System-styled listbox and commits the selected option", () => {
    const onChange = vi.fn();
    flushSync(() =>
      root.render(
        <FlatDropdown
          ariaLabel="Mask style"
          value="none"
          options={[
            { value: "none", label: "None" },
            { value: "circle", label: "Circle" },
          ]}
          onChange={onChange}
        />,
      ),
    );

    const trigger = container.querySelector('[aria-label="Mask style"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Dropdown trigger missing");
    flushSync(() => trigger.click());

    const listbox = document.body.querySelector('[role="listbox"]');
    const circle = document.body.querySelector('[role="option"]:last-child');
    expect(listbox).not.toBeNull();
    if (!(circle instanceof HTMLButtonElement)) throw new Error("Dropdown option missing");
    flushSync(() => circle.click());

    expect(onChange).toHaveBeenCalledWith("circle");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it("keeps disabled dropdowns closed", () => {
    const onChange = vi.fn();
    flushSync(() =>
      root.render(
        <FlatDropdown
          ariaLabel="Mask style"
          value="none"
          options={[{ value: "none", label: "None" }]}
          disabled
          onChange={onChange}
        />,
      ),
    );
    const trigger = container.querySelector("button");
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Dropdown trigger missing");
    trigger.click();
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("mask geometry", () => {
  it("round-trips rectangular mask bounds through clip-path inset", () => {
    const clipPath = buildMaskGeometry(
      "rectangle",
      { x: 10, y: 20, width: 160, height: 60 },
      200,
      100,
      8,
    );
    expect(clipPath).toBe("inset(20px 30px 20px 10px round 8px)");
    expect(parseMaskGeometry(clipPath, 200, 100)).toEqual({
      x: 10,
      y: 20,
      width: 160,
      height: 60,
    });
  });

  it("preserves circular and elliptical bounds", () => {
    const circle = buildMaskGeometry(
      "circle",
      { x: 25, y: 10, width: 50, height: 80 },
      100,
      100,
      0,
    );
    expect(circle).toBe("ellipse(25px 40px at 50px 50px)");
    expect(inferMaskShape(circle)).toBe("circle");
    expect(parseMaskGeometry(circle, 100, 100)).toEqual({
      x: 25,
      y: 10,
      width: 50,
      height: 80,
    });
  });
});

describe("FlatRow responsive layout", () => {
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

  it("keeps the editable value shrinkable while reserving the trailing control slot", () => {
    flushSync(() =>
      root.render(
        <FlatRow
          label="Rotation"
          value="0°"
          tier="default"
          suffix={<button type="button">Keyframe</button>}
          onCommit={() => undefined}
        />,
      ),
    );

    const row = container.firstElementChild;
    const value = container.querySelector('[data-flat-row-value="true"]');
    const trailingControls = value?.parentElement;
    expect(row?.classList.contains("overflow-hidden")).toBe(true);
    expect(value?.classList.contains("flex-1")).toBe(true);
    expect(value?.classList.contains("overflow-hidden")).toBe(true);
    expect(trailingControls?.classList.contains("flex-1")).toBe(true);
    expect(trailingControls?.classList.contains("min-w-0")).toBe(true);
  });
});
