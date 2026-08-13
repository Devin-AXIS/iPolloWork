// @vitest-environment happy-dom
import { createElement, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection, DomEditTextField } from "../components/editor/domEditing";
import {
  findDomTextFieldElement,
  textFieldStyleTargetsSelectedElement,
  useDomEditTextCommits,
} from "./useDomEditTextCommits";

function textField(key: string, value: string): DomEditTextField {
  return {
    key,
    label: value,
    value,
    tagName: "div",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: "child",
    sourceChildIndex: 0,
  };
}

describe("findDomTextFieldElement", () => {
  it("resolves the exact same-tag child selected by a text-list remove button", () => {
    const parent = document.createElement("section");
    parent.innerHTML = "<div>First</div><h1>Heading</h1><div>Second</div>";
    const first = textField("first", "First");
    const second = { ...textField("second", "Second"), sourceChildIndex: 1 };

    expect(findDomTextFieldElement(parent, [first, second], second.key)?.textContent).toBe(
      "Second",
    );
  });
});

describe("textFieldStyleTargetsSelectedElement", () => {
  it("applies direct text-node typography to the selected element", () => {
    expect(textFieldStyleTargetsSelectedElement("self")).toBe(true);
    expect(textFieldStyleTargetsSelectedElement("text-node")).toBe(true);
    expect(textFieldStyleTargetsSelectedElement("child")).toBe(false);
  });
});

function editableTextSelection(element: HTMLElement): DomEditSelection {
  return {
    element,
    id: element.id,
    selector: `#${element.id}`,
    label: "Title",
    tagName: "span",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 200, height: 40 },
    textContent: element.textContent,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [
      {
        key: "text-node:0",
        label: element.textContent ?? "",
        value: element.textContent ?? "",
        tagName: "span",
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
}

describe("useDomEditTextCommits", () => {
  it("updates the preview immediately and queues a lightweight HTML text patch", async () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { value: document });
    const target = document.createElement("span");
    target.id = "title";
    target.textContent = "Before";
    document.body.append(target);
    const selection = editableTextSelection(target);
    const persistDomEditOperations = vi.fn(async () => {});
    const queueDomEditSave = vi.fn(<T>(save: () => Promise<T>) => save());
    const applyDomSelection = vi.fn();
    const previewIframeRef: MutableRefObject<HTMLIFrameElement | null> = { current: iframe };
    let result: ReturnType<typeof useDomEditTextCommits> | null = null;

    function Harness() {
      result = useDomEditTextCommits({
        activeCompPath: "index.html",
        previewIframeRef,
        showToast: vi.fn(),
        domEditSelection: selection,
        applyDomSelection,
        refreshDomEditSelectionFromPreview: vi.fn(),
        buildDomSelectionFromTarget: async () => selection,
        removeDomTextFieldElement: async () => {},
        persistDomEditOperations,
        queueDomEditSave,
        resolveImportedFontAsset: () => null,
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    flushSync(() => root.render(createElement(Harness)));
    if (!result) throw new Error("Hook result missing");

    await result.handleDomTextCommit("After", "text-node:0");

    expect(target.textContent).toBe("After");
    expect(queueDomEditSave).toHaveBeenCalledOnce();
    expect(persistDomEditOperations).toHaveBeenCalledWith(
      selection,
      [{ type: "text-content", property: "text", value: "After" }],
      expect.objectContaining({
        label: "Edit text",
        skipRefresh: true,
        skipSdkCutover: true,
      }),
    );

    flushSync(() => root.unmount());
    container.remove();
    target.remove();
  });
});
