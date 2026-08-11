import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../player/store/playerStore";
import {
  findSelectedTimelineElement,
  rebaseExpandedTimelineEdit,
} from "./timelineToolbarSelection";

const nestedElement: TimelineElement = {
  id: "nested.html#headline",
  key: "nested.html#headline",
  domId: "headline",
  tag: "div",
  label: "Headline",
  start: 12,
  duration: 4,
  track: 1,
  expandedParentStart: 10,
};

describe("timeline toolbar selection", () => {
  it("finds a selected child from the expanded timeline tree", () => {
    expect(findSelectedTimelineElement([nestedElement], "nested.html#headline")).toBe(
      nestedElement,
    );
  });

  it("resolves preview selection aliases for expanded timeline rows", () => {
    expect(findSelectedTimelineElement([nestedElement], "headline")).toBe(nestedElement);
    expect(
      findSelectedTimelineElement([{ ...nestedElement, domId: undefined, hfId: "hero-title" }], "hero-title"),
    ).toEqual(expect.objectContaining({ hfId: "hero-title" }));
  });

  it("prefers an exact timeline id over a nested DOM alias", () => {
    const topLevel = { ...nestedElement, id: "headline", key: "headline", domId: undefined };
    expect(findSelectedTimelineElement([nestedElement, topLevel], "headline")).toBe(topLevel);
  });

  it("falls back to the selected set when the primary selection is temporarily empty", () => {
    expect(
      findSelectedTimelineElement(
        [nestedElement],
        null,
        new Set(["nested.html#headline"]),
      ),
    ).toBe(nestedElement);
  });

  it("rebases nested child edits into their source composition", () => {
    expect(rebaseExpandedTimelineEdit(nestedElement, 13)).toEqual({
      element: expect.objectContaining({ id: "headline", start: 2 }),
      time: 3,
    });
  });

  it("leaves top-level edits unchanged", () => {
    const topLevel = { ...nestedElement, id: "headline", expandedParentStart: undefined };
    expect(rebaseExpandedTimelineEdit(topLevel, 3)).toEqual({ element: topLevel, time: 3 });
  });
});
