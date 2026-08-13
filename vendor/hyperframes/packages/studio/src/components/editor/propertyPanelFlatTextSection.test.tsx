// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDomEditStylePatchOperation, type DomEditSelection } from "./domEditing";
import {
  FlatTextSection,
  resolveNumericTextMetricValue,
  TextIconButton,
  toggleDecoration,
} from "./propertyPanelFlatTextSection";

describe("TextIconButton", () => {
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

  it("reports pressed state and commits an enabled formatting action", () => {
    const onClick = vi.fn();
    flushSync(() =>
      root.render(
        <TextIconButton label="Bold" active onClick={onClick}>
          B
        </TextIconButton>,
      ),
    );

    const button = container.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Text format button missing");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("hf-text-icon-button")).toBe(true);
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps unsupported list actions disabled", () => {
    const onClick = vi.fn();
    flushSync(() =>
      root.render(
        <TextIconButton label="Bulleted list" disabled onClick={onClick}>
          List
        </TextIconButton>,
      ),
    );

    const button = container.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Text list button missing");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBeNull();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("toggleDecoration", () => {
  it("preserves independent underline and strikethrough states", () => {
    expect(toggleDecoration("none", "underline")).toBe("underline");
    expect(toggleDecoration("underline", "line-through")).toBe("underline line-through");
    expect(toggleDecoration("underline line-through", "underline")).toBe("line-through");
    expect(toggleDecoration("line-through", "line-through")).toBe("none");
  });
});

describe("text metric style commits", () => {
  it("removes a declaration when a text metric is reset", () => {
    expect(buildDomEditStylePatchOperation("line-height", "")).toEqual({
      type: "inline-style",
      property: "line-height",
      value: null,
    });
    expect(buildDomEditStylePatchOperation("letter-spacing", "")).toEqual({
      type: "inline-style",
      property: "letter-spacing",
      value: null,
    });
  });

  it("converts computed text metrics into clear pixel numbers", () => {
    expect(resolveNumericTextMetricValue("line-height", "normal", "34px")).toBe("40.8");
    expect(resolveNumericTextMetricValue("line-height", "1.5", "20px")).toBe("30");
    expect(resolveNumericTextMetricValue("letter-spacing", "normal", "20px")).toBe("0");
    expect(resolveNumericTextMetricValue("letter-spacing", "0.05em", "20px")).toBe("1");
  });

  it("offers selectable font size and numeric text metric inputs", () => {
    const elementNode = document.createElement("p");
    const element: DomEditSelection = {
      element: elementNode,
      label: "Lede",
      tagName: "p",
      sourceFile: "index.html",
      compositionPath: "index.html",
      isCompositionHost: false,
      isInsideLockedComposition: false,
      boundingBox: { x: 0, y: 0, width: 320, height: 80 },
      textContent: "Example",
      dataAttributes: {},
      inlineStyles: {},
      computedStyles: {
        "font-size": "20px",
        "line-height": "normal",
        "letter-spacing": "normal",
      },
      textFields: [
        {
          key: "text-node:0",
          label: "Example",
          value: "Example",
          tagName: "p",
          attributes: [],
          inlineStyles: {},
          computedStyles: {
            "font-size": "20px",
            "line-height": "normal",
            "letter-spacing": "normal",
          },
          source: "text-node",
        },
      ],
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
    };
    const onSetTextFieldStyle = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        <FlatTextSection
          element={element}
          styles={element.computedStyles}
          fontAssets={[]}
          onSetText={vi.fn()}
          onSetTextFieldStyle={onSetTextFieldStyle}
          onAddTextField={vi.fn()}
          onRemoveTextField={vi.fn()}
        />,
      ),
    );

    const size = container.querySelector('[aria-label="Size"]');
    if (!(size instanceof HTMLButtonElement)) throw new Error("Font size selector missing");
    flushSync(() => size.click());
    const sizeOption = [...document.body.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent?.trim() === "32",
    );
    if (!(sizeOption instanceof HTMLButtonElement)) throw new Error("Font size option missing");
    flushSync(() => sizeOption.click());

    const lineHeight = container.querySelector('[aria-label="Line height"]');
    const spacing = container.querySelector('[aria-label="Letter spacing"]');
    if (!(lineHeight instanceof HTMLInputElement) || !(spacing instanceof HTMLInputElement)) {
      throw new Error("Numeric text metric inputs missing");
    }
    expect(lineHeight.type).toBe("number");
    expect(lineHeight.value).toBe("24");
    expect(spacing.type).toBe("number");
    expect(spacing.value).toBe("0");

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) throw new Error("Input value setter missing");
    flushSync(() => {
      valueSetter.call(lineHeight, "30");
      lineHeight.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => {
      lineHeight.focus();
      lineHeight.blur();
    });
    flushSync(() => {
      valueSetter.call(spacing, "1.5");
      spacing.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => {
      spacing.focus();
      spacing.blur();
    });

    expect(onSetTextFieldStyle).toHaveBeenNthCalledWith(1, "text-node:0", "font-size", "32px");
    expect(onSetTextFieldStyle).toHaveBeenNthCalledWith(2, "text-node:0", "line-height", "30px");
    expect(onSetTextFieldStyle).toHaveBeenNthCalledWith(
      3,
      "text-node:0",
      "letter-spacing",
      "1.5px",
    );
    flushSync(() => root.unmount());
    container.remove();
  });
});

describe("text content commits", () => {
  it("keeps focused text as a draft and commits it only on blur", () => {
    vi.useFakeTimers();
    const elementNode = document.createElement("p");
    const element: DomEditSelection = {
      element: elementNode,
      label: "Version",
      tagName: "p",
      sourceFile: "index.html",
      compositionPath: "index.html",
      isCompositionHost: false,
      isInsideLockedComposition: false,
      boundingBox: { x: 0, y: 0, width: 320, height: 80 },
      textContent: "2026",
      dataAttributes: {},
      inlineStyles: {},
      computedStyles: {},
      textFields: [
        {
          key: "text-node:0",
          label: "2026",
          value: "2026",
          tagName: "p",
          attributes: [],
          inlineStyles: {},
          computedStyles: {},
          source: "text-node",
        },
      ],
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
    };
    const onSetText = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        <FlatTextSection
          element={element}
          styles={{}}
          fontAssets={[]}
          onSetText={onSetText}
          onSetTextFieldStyle={vi.fn()}
          onAddTextField={vi.fn()}
          onRemoveTextField={vi.fn()}
        />,
      ),
    );

    const textarea = container.querySelector('textarea[aria-label="Content"]');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Text input missing");
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!valueSetter) throw new Error("Textarea value setter missing");

    textarea.focus();
    flushSync(() => {
      valueSetter.call(textarea, "2026 世界的");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      expect(onSetText).not.toHaveBeenCalled();
      textarea.blur();
    });
    expect(onSetText).toHaveBeenCalledOnce();
    expect(onSetText).toHaveBeenCalledWith("2026 世界的", "text-node:0");

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("keeps the single-line value visible and commits it when Enter is pressed", () => {
    const elementNode = document.createElement("p");
    const element: DomEditSelection = {
      element: elementNode,
      label: "Version",
      tagName: "p",
      sourceFile: "index.html",
      compositionPath: "index.html",
      isCompositionHost: false,
      isInsideLockedComposition: false,
      boundingBox: { x: 0, y: 0, width: 320, height: 80 },
      textContent: "2026",
      dataAttributes: {},
      inlineStyles: {},
      computedStyles: {},
      textFields: [
        {
          key: "text-node:0",
          label: "2026",
          value: "2026",
          tagName: "p",
          attributes: [],
          inlineStyles: {},
          computedStyles: {},
          source: "text-node",
        },
      ],
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
    };
    const onSetText = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        <FlatTextSection
          element={element}
          styles={{}}
          fontAssets={[]}
          onSetText={onSetText}
          onSetTextFieldStyle={vi.fn()}
          onAddTextField={vi.fn()}
          onRemoveTextField={vi.fn()}
        />,
      ),
    );

    const textarea = container.querySelector('textarea[aria-label="Content"]');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Text input missing");
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!valueSetter) throw new Error("Textarea value setter missing");

    textarea.focus();
    let enterEvent: KeyboardEvent | undefined;
    flushSync(() => {
      valueSetter.call(textarea, "2026 world");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      textarea.dispatchEvent(enterEvent);
    });

    expect(enterEvent?.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(textarea);
    expect(textarea.value).toBe("2026 world");
    expect(onSetText).toHaveBeenCalledOnce();
    expect(onSetText).toHaveBeenCalledWith("2026 world", "text-node:0");

    flushSync(() => root.unmount());
    container.remove();
  });
});
