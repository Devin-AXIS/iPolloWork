import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  buildTimelineColorIndexes,
  resolveTimelineBindingId,
  resolveTimelineKind,
  resolveTimelineColorGroupKey,
  resolveTimelineLayerDepth,
  resolveTimelineLayerLabel,
} from "./timelineLayerPresentation";

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

  test("exposes authored binding metadata without inventing a group", () => {
    expect(
      resolveTimelineBindingId([
        element({ id: "empty", timelineGroupId: " " }),
        element({ id: "bound", timelineGroupId: "brand-lockup" }),
      ]),
    ).toBe("brand-lockup");
    expect(resolveTimelineBindingId([element()])).toBeNull();
  });
});
