// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDomEditStylePatchOperation, type DomEditSelection } from "./domEditing";
import {
  FlatTextSection,
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

  it("offers selectable font size and letter spacing values", () => {
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
      computedStyles: { "font-size": "20px", "letter-spacing": "normal" },
      textFields: [
        {
          key: "text-node:0",
          label: "Example",
          value: "Example",
          tagName: "p",
          attributes: [],
          inlineStyles: {},
          computedStyles: { "font-size": "20px", "letter-spacing": "normal" },
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

    const spacing = container.querySelector('[aria-label="Letter spacing"]');
    if (!(spacing instanceof HTMLButtonElement)) throw new Error("Letter spacing selector missing");
    flushSync(() => spacing.click());
    const spacingOption = [...document.body.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent?.trim() === "1 px",
    );
    if (!(spacingOption instanceof HTMLButtonElement)) {
      throw new Error("Letter spacing option missing");
    }
    flushSync(() => spacingOption.click());

    expect(onSetTextFieldStyle).toHaveBeenNthCalledWith(1, "text-node:0", "font-size", "32px");
    expect(onSetTextFieldStyle).toHaveBeenNthCalledWith(
      2,
      "text-node:0",
      "letter-spacing",
      "1px",
    );
    flushSync(() => root.unmount());
    container.remove();
  });
});
