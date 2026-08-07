import { describe, expect, test } from "vitest";
import {
  collectTimelineAncestorIds,
  resolveTimelineTreeSelectionId,
  resolveTimelineTreeSelectionKey,
} from "./timelineTreeSelection";

describe("timeline tree selection", () => {
  test("collects every ancestor from root to the selected node's parent", () => {
    expect(
      collectTimelineAncestorIds(
        "title",
        new Map([
          ["title", "hero"],
          ["hero", "scene"],
        ]),
      ),
    ).toEqual(["scene", "hero"]);
  });

  test("uses the nested source file key for a DOM-only child", () => {
    expect(
      resolveTimelineTreeSelectionKey({
        elementId: "title",
        sourceFile: "index.html",
        elements: [],
        manifest: [],
        domClipChildren: [
          {
            id: "title",
            parentId: "hero",
            hostId: "scene",
            label: "Title",
            sourceFile: "compositions/scene.html",
            stackingContextId: "root",
          },
        ],
      }),
    ).toBe("scene::compositions/scene.html#title");
  });

  test("does not select a same-id element from another composition", () => {
    const shared = { id: "title", domId: "title", tag: "h1", start: 0, duration: 3, track: 0 };
    expect(
      resolveTimelineTreeSelectionKey({
        elementId: "title",
        sourceFile: "compositions/second.html",
        elements: [
          { ...shared, key: "compositions/first.html#title", sourceFile: "compositions/first.html" },
          { ...shared, key: "compositions/second.html#title", sourceFile: "compositions/second.html" },
        ],
        manifest: [],
        domClipChildren: [],
      }),
    ).toBe("compositions/second.html#title");
  });

  test("resolves an id-less preview selection through its hf id and expands its parents", () => {
    const domClipChildren = [
      {
        id: "hf-title",
        hfId: "hf-title",
        parentId: "hero",
        hostId: "scene",
        label: "Title",
        sourceFile: "compositions/scene.html",
        selector: ".title",
        selectorIndex: 0,
        stackingContextId: "root",
      },
    ];
    const input = {
      hfId: "hf-title",
      sourceFile: "compositions/scene.html",
      elements: [],
      manifest: [],
      domClipChildren,
    };

    expect(resolveTimelineTreeSelectionId(input)).toBe("hf-title");
    expect(resolveTimelineTreeSelectionKey(input)).toBe(
      "scene::compositions/scene.html:.title:0",
    );
    expect(collectTimelineAncestorIds("hf-title", new Map([["hf-title", "hero"]]))).toEqual([
      "hero",
    ]);
  });

  test("resolves a selector-only preview element to its timeline tree identity", () => {
    const domClipChildren = [
      {
        id: "compositions/scene.html:h2:1",
        parentId: "hero",
        hostId: "scene",
        label: "H2",
        sourceFile: "compositions/scene.html",
        selector: "h2",
        selectorIndex: 1,
        stackingContextId: "root",
      },
    ];
    expect(
      resolveTimelineTreeSelectionId({
        sourceFile: "compositions/scene.html",
        selector: "h2",
        selectorIndex: 1,
        elements: [],
        manifest: [],
        domClipChildren,
      }),
    ).toBe("compositions/scene.html:h2:1");
  });

  test("maps a runtime data-hf-id back to the manifest row that owns that id", () => {
    expect(
      resolveTimelineTreeSelectionKey({
        hfId: "hf-logo",
        sourceFile: "index.html",
        elements: [
          {
            id: "hf-logo",
            key: "index.html:hf-logo:0",
            tag: "img",
            start: 0,
            duration: 8,
            track: 0,
          },
        ],
        manifest: [],
        domClipChildren: [],
      }),
    ).toBe("index.html:hf-logo:0");
  });

  test("keeps a runtime media selection on its enriched expanded timeline key", () => {
    expect(
      resolveTimelineTreeSelectionKey({
        elementId: "hf-logo",
        hfId: "hf-logo",
        sourceFile: "index.html",
        elements: [
          {
            id: "hf-logo",
            key: "index.html:hf-logo:0",
            tag: "img",
            start: 0,
            duration: 8,
            track: 0,
          },
        ],
        manifest: [],
        domClipChildren: [
          {
            id: "hf-logo",
            hfId: "hf-logo",
            parentId: "logo-wrap",
            hostId: "index.html:.logo-wrap:0",
            label: "Absolute",
            sourceFile: "index.html",
            selector: ".absolute",
            selectorIndex: 1,
            stackingContextId: "root",
          },
        ],
      }),
    ).toBe("index.html:.logo-wrap:0::index.html:.absolute:1");
  });
});
