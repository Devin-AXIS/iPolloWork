// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextIconButton, toggleDecoration } from "./propertyPanelFlatTextSection";

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
