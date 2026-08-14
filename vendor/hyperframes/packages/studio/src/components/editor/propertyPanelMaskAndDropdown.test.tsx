// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMaskGeometry, inferMaskShape, parseMaskGeometry } from "./clipPathHelpers";
import { GeometryStepper } from "./propertyPanelFlatLayoutSection";
import { FlatMaskSection } from "./propertyPanelFlatMaskSection";
import { FlatRow, FlatSlider } from "./propertyPanelFlatPrimitives";
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

describe("FlatMaskSection", () => {
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

  it("offers only rectangle and circle post-processing masks", () => {
    const onSetStyle = vi.fn();
    flushSync(() =>
      root.render(
        <FlatMaskSection
          styles={{ width: "200px", height: "100px" }}
          disabled={false}
          onSetStyle={onSetStyle}
        />,
      ),
    );

    const trigger = container.querySelector('[aria-label="Style"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Mask dropdown missing");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(trigger.textContent).toContain("Mask rectangle");
    flushSync(() => trigger.click());

    const options = [...document.body.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      "Mask rectangle",
      "Mask circle",
    ]);
    const circle = options[1];
    if (!(circle instanceof HTMLButtonElement)) throw new Error("Circle option missing");
    flushSync(() => circle.click());

    expect(onSetStyle).toHaveBeenCalledWith(
      "clip-path",
      "circle(50px at 100px 50px)",
    );
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

describe("GeometryStepper", () => {
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

  it("offers only decrement and increment actions and accumulates rapid clicks", () => {
    const onStep = vi.fn();
    flushSync(() => root.render(<GeometryStepper label="X" value={56} onStep={onStep} />));

    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(container.querySelector('[data-flat-kf-gutter="true"]')).toBeNull();

    buttons[1]?.click();
    buttons[1]?.click();
    buttons[0]?.click();
    expect(onStep.mock.calls.map(([value]) => value)).toEqual([57, 58, 57]);
  });
});

describe("FlatSlider value surface", () => {
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

  it("lets a large slider use the full row without a value surface", () => {
    flushSync(() =>
      root.render(
        <FlatSlider
          label="Shadow"
          value={50}
          min={0}
          max={100}
          tier="explicitCustom"
          displayValue="50%"
          showValue={false}
          onCommit={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('[data-flat-slider-value="true"]')).toBeNull();
    expect(container.querySelector('[data-flat-slider-track="true"]')?.classList).toContain(
      "col-span-2",
    );
  });

  it("commits the last visible value when pointer capture is lost", () => {
    const onPreview = vi.fn();
    const onPreviewCancel = vi.fn();
    const onCommit = vi.fn();
    flushSync(() =>
      root.render(
        <FlatSlider
          label="Shadow"
          value={20}
          min={0}
          max={100}
          tier="explicitCustom"
          displayValue="20%"
          commitMode="release"
          onPreview={onPreview}
          onPreviewCancel={onPreviewCancel}
          onCommit={onCommit}
        />,
      ),
    );

    const slider = container.querySelector('[data-flat-slider-track="true"]');
    if (!(slider instanceof HTMLDivElement)) throw new Error("Shadow slider missing");
    Object.defineProperty(slider, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, right: 100, top: 0, bottom: 34, width: 100, height: 34 }),
    });
    let capturedPointer: number | null = null;
    slider.setPointerCapture = (pointerId) => {
      capturedPointer = pointerId;
    };
    slider.hasPointerCapture = (pointerId) => capturedPointer === pointerId;
    slider.releasePointerCapture = () => {
      capturedPointer = null;
    };

    flushSync(() =>
      slider.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 30, pointerId: 1 }),
      ),
    );
    flushSync(() =>
      slider.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 73, pointerId: 1 }),
      ),
    );
    flushSync(() => slider.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true })));

    expect(onPreview).toHaveBeenLastCalledWith(73);
    expect(onPreviewCancel).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(73);
  });

  it.each([0, 10_000])(
    "keeps the last visible value when pointerup reports clientX %s",
    (releaseClientX) => {
      const onPreview = vi.fn();
      const onCommit = vi.fn();
      flushSync(() =>
        root.render(
          <FlatSlider
            label="Shadow"
            value={20}
            min={0}
            max={100}
            tier="explicitCustom"
            displayValue="20%"
            commitMode="release"
            onPreview={onPreview}
            onCommit={onCommit}
          />,
        ),
      );

      const slider = container.querySelector('[data-flat-slider-track="true"]');
      if (!(slider instanceof HTMLDivElement)) throw new Error("Shadow slider missing");
      Object.defineProperty(slider, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 0, right: 100, top: 0, bottom: 34, width: 100, height: 34 }),
      });
      let capturedPointer: number | null = null;
      slider.setPointerCapture = (pointerId) => {
        capturedPointer = pointerId;
      };
      slider.hasPointerCapture = (pointerId) => capturedPointer === pointerId;
      slider.releasePointerCapture = () => {
        capturedPointer = null;
      };

      flushSync(() =>
        slider.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, clientX: 30, pointerId: 1 }),
        ),
      );
      flushSync(() =>
        slider.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX: 73, pointerId: 1 }),
        ),
      );
      flushSync(() =>
        slider.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: releaseClientX,
            pointerId: 1,
          }),
        ),
      );

      expect(onPreview).toHaveBeenLastCalledWith(73);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenLastCalledWith(73);
    },
  );
});
