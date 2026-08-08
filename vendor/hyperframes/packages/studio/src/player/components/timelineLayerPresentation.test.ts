import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  buildTimelineColorIndexes,
  resolveTimelineBindingId,
  resolveTimelineKind,
  resolveTimelineColorGroupKey,
  resolveTimelineLayerDepth,
  resolveTimelineLayerLabel,
  shouldDisplayTimelineElement,
} from "./timelineLayerPresentation";
import { getTimelinePaletteStyle, getTimelineTrackStyle } from "./timelineTheme";

function element(overrides: Partial<TimelineElement> = {}): TimelineElement {
  return {
    id: "layer",
    tag: "div",
    start: 0,
    duration: 5,
    track: 0,
    ...overrides,
  };
}

describe("timeline layer presentation", () => {
  test("prefers explicit authored kinds", () => {
    expect(resolveTimelineKind(element({ tag: "div", timelineKind: "effect" }))).toBe("effect");
    expect(resolveTimelineKind(element({ tag: "img", timelineKind: "logo" }))).toBe("logo");
  });

  test("classifies legacy text, logo, composition, and audio layers", () => {
    expect(resolveTimelineKind(element({ tag: "h1" }))).toBe("text");
    expect(resolveTimelineKind(element({ tag: "img", id: "brand-logo" }))).toBe("logo");
    expect(resolveTimelineKind(element({ compositionSrc: "compositions/card.html" }))).toBe(
      "composition",
    );
    expect(
      resolveTimelineKind(element({ tag: "audio", timelineRole: "music", src: "music.mp3" })),
    ).toBe("music");
    expect(
      resolveTimelineKind(
        element({ tag: "audio", timelineRole: "voiceover", src: "voiceover.mp3" }),
      ),
    ).toBe("voiceover");
  });

  test("resolves stable labels and expanded hierarchy depth", () => {
    expect(resolveTimelineLayerLabel([element({ label: "Scene title" })], 0)).toBe("Scene title");
    expect(resolveTimelineLayerLabel([], 2)).toBe("Layer 3");
    expect(resolveTimelineLayerDepth([element()])).toBe(0);
    expect(
      resolveTimelineLayerDepth([
        element({ expandedParentStart: 2, compositionAncestors: ["root", "card"] }),
      ]),
    ).toBe(2);
  });

  test("keeps bound colors together and independent colors distinct", () => {
    const boundA = element({ id: "bound-a", timelineGroupId: "brand" });
    const boundB = element({ id: "bound-b", timelineGroupId: "brand" });
    const independentA = element({ id: "free-a", key: "free-a" });
    const independentB = element({ id: "free-b", key: "free-b" });
    const indexes = buildTimelineColorIndexes([boundA, boundB, independentA, independentB]);

    expect(resolveTimelineColorGroupKey(boundA)).toBe(resolveTimelineColorGroupKey(boundB));
    expect(indexes.get(resolveTimelineColorGroupKey(boundA))).toBe(
      indexes.get(resolveTimelineColorGroupKey(boundB)),
    );
    expect(indexes.get(resolveTimelineColorGroupKey(independentA))).not.toBe(
      indexes.get(resolveTimelineColorGroupKey(independentB)),
    );
  });

  test("uses one neutral clip style for every timeline kind and palette index", () => {
    const expected = {
      accent: "#20BBC0",
      clip: "var(--hf-timeline-clip-bg)",
      clipActive: "var(--hf-timeline-clip-active)",
      border: "var(--hf-timeline-clip-border)",
      hover: "var(--hf-timeline-clip-hover)",
      dragging: "#20BBC0",
      label: "var(--hf-timeline-clip-text)",
    };

    expect(getTimelineTrackStyle("text")).toEqual(expected);
    expect(getTimelineTrackStyle("audio")).toEqual(expected);
    expect(getTimelinePaletteStyle(0)).toEqual(expected);
    expect(getTimelinePaletteStyle(11)).toEqual(expected);
  });

  test("exposes authored binding metadata without inventing a group", () => {
    expect(
      resolveTimelineBindingId([
        element({ id: "empty", timelineGroupId: " " }),
        element({ id: "bound", timelineGroupId: "brand-lockup" }),
      ]),
    ).toBe("brand-lockup");
    expect(resolveTimelineBindingId([element()])).toBeNull();
  });

  test("hides only implicit structural wrappers", () => {
    expect(
      shouldDisplayTimelineElement(element({ id: "chrome", timingSource: "implicit" }), false),
    ).toBe(false);
    expect(
      shouldDisplayTimelineElement(
        element({ id: "animated-shape", timingSource: "implicit" }),
        true,
      ),
    ).toBe(true);
    expect(
      shouldDisplayTimelineElement(
        element({ id: "title", tag: "h1", timingSource: "implicit" }),
        false,
      ),
    ).toBe(true);
    expect(
      shouldDisplayTimelineElement(
        element({ id: "declared-overlay", timelineRole: "overlay", timingSource: "implicit" }),
        false,
      ),
    ).toBe(true);
    expect(
      shouldDisplayTimelineElement(
        element({ id: "authored-wrapper", timingSource: "authored" }),
        false,
      ),
    ).toBe(true);
  });

  test("keeps an implicit structural parent visible when it owns selectable children", () => {
    expect(
      shouldDisplayTimelineElement(
        element({ id: "topbar", timingSource: "implicit", tag: "header" }),
        false,
        true,
      ),
    ).toBe(true);
  });
});
