import { describe, expect, test } from "vitest";
import {
  collectTimelineAncestorIds,
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
    ).toBe("compositions/scene.html#title");
  });
});
