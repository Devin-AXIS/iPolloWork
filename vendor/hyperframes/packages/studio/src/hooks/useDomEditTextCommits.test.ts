// @vitest-environment happy-dom
import { createElement, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";
import type { DomEditSelection, DomEditTextField } from "../components/editor/domEditing";
import {
  applyTextFieldChildOperations,
  buildTextFieldChildOperations,
} from "./domEditTextFieldCommitOps";
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

describe("child text preview identity", () => {
  it("persists a child text draft even when the live selection already reflects it", () => {
    const field = textField("title", "Live draft");
    expect(buildTextFieldChildOperations([field], [field], field.key)).toEqual([
      {
        type: "text-content",
        property: "text",
        value: "Live draft",
        childSelector: ":scope > div",
        childIndex: 0,
      },
    ]);
  });

  it("keeps graphics, sibling text and the GSAP target through edit and rollback", () => {
    const parent = document.createElement("div");
    parent.innerHTML = '<svg><path d="M0 0L1 1"></path></svg><span>First</span><span>Second</span>';
    const graphic = parent.firstElementChild;
    const target = parent.querySelector("span");
    const sibling = parent.lastElementChild;
    const fields = [
      { ...textField("first", "First"), tagName: "span", sourceChildIndex: 0 },
      { ...textField("second", "Second"), tagName: "span", sourceChildIndex: 1 },
    ];
    const next = fields.map((field) =>
      field.key === "first" ? { ...field, value: "Edited" } : field,
    );
    const operations = buildTextFieldChildOperations(fields, next);
    if (!operations) throw new Error("Child patch missing");
    const revert = applyTextFieldChildOperations(parent, operations);
    expect(parent.firstElementChild).toBe(graphic);
    expect(parent.querySelector("span")).toBe(target);
    expect(parent.lastElementChild).toBe(sibling);
    expect(target?.textContent).toBe("Edited");
    expect(sibling?.textContent).toBe("Second");
    revert();
    expect(parent.querySelector("span")).toBe(target);
    expect(target?.textContent).toBe("First");
  });
});

describe("component Properties timing commits", () => {
  it("retimes a component's full source atomically with its display slot", async () => {
    const target = document.createElement("div");
    target.id = "properties-component";
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ content: '<template><div data-composition-id="scene" data-duration="10"></div></template>' }) }));
    vi.stubGlobal("fetch", fetchMock);
    target.setAttribute("data-playback-start", "-2");
    target.setAttribute("data-duration", "10");
    document.body.append(target);
    const selection = {
      ...editableTextSelection(target),
      tagName: "div",
      isCompositionHost: true,
      compositionSrc: "scene.html",
    };
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { value: document });
    const persist = vi.fn(async () => {});
    let result: ReturnType<typeof useDomEditAttributeCommits> | undefined;
    function Harness() {
      result = useDomEditTextCommits({
        projectId: "props-project",
        applyDomSelection: vi.fn(),
        buildDomSelectionFromTarget: async () => selection,
        removeDomTextFieldElement: async () => {},
        queueDomEditSave: <T,>(save: () => Promise<T>) => save(),
        resolveImportedFontAsset: () => null,
        activeCompPath: "index.html",
        previewIframeRef: { current: iframe },
        showToast: vi.fn(),
        domEditSelection: selection,
        refreshDomEditSelectionFromPreview: vi.fn(),
        persistDomEditOperations: persist,
      });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    flushSync(() => root.render(createElement(Harness)));
    await result!.handleDomAttributesCommit(selection, {
      start: "0",
      duration: "20",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/props-project/files/scene.html");
    expect(target.getAttribute("data-playback-rate")).toBe("0.5");
    expect(target.getAttribute("data-playback-start")).toBe("0");
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        { type: "attribute", property: "duration", value: "20" },
        { type: "attribute", property: "playback-rate", value: "0.5" },
        { type: "attribute", property: "playback-start", value: "0" },
      ]),
    );
    persist.mockImplementationOnce(async () => {
      throw new Error("Save failed");
    });
    await result!.handleDomAttributeCommit("duration", "5");
    expect(target.getAttribute("data-duration")).toBe("20");
    expect(target.getAttribute("data-playback-rate")).toBe("0.5");
    flushSync(() => root.unmount());
    container.remove();
    target.remove();
    vi.unstubAllGlobals();
  });
});
