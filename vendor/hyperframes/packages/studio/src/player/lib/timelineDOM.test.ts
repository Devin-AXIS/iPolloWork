import { describe, expect, test } from "vitest";
import type { ClipManifestClip } from "./playbackTypes";
import { createTimelineElementFromManifestClip } from "./timelineDOM";

const MANIFEST_CLIP: ClipManifestClip = {
  id: "headline",
  label: "Headline",
  start: 1,
  duration: 3,
  track: 0,
  kind: "element",
  tagName: "h1",
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
  timelineRole: "title",
  timelineGroup: "intro-lockup",
};

describe("timeline manifest translation", () => {
  test("preserves binding metadata when the host DOM node is unavailable", () => {
    const element = createTimelineElementFromManifestClip({
      clip: MANIFEST_CLIP,
      fallbackIndex: 0,
    });

    expect(element.timelineRole).toBe("title");
    expect(element.timelineGroupId).toBe("intro-lockup");
  });
});
