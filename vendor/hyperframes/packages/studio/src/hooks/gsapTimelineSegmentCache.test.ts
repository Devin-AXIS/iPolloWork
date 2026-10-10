import { describe, expect, test } from "vitest";
import { parseGsapScript } from "@hyperframes/core/gsap-parser";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import { addKeyframeToScript } from "@hyperframes/core/gsap-writer-acorn";
import { updateKeyframeCacheFromParsed } from "./gsapKeyframeCacheHelpers";
import { usePlayerStore } from "../player/store/playerStore";
import { animatedProps } from "./useEnableKeyframes";
import { markManualKeyframe } from "./gsapShared";
import { deduplicateKeyframes } from "./gsapTweenSynth";
import {
  resolveGsapTimelineTargetKeys,
  resolveMotionTimelineTargetKeys,
} from "./gsapTimelineSegmentCache";
import { resolveClipTimingBasis } from "./useGsapTweenCache";

test("native writer and both parsers preserve point origin, ease, timing and position group", () => {
  const source = 'const tl = gsap.timeline(); tl.to("#title", {duration: 3, keyframes: {"0%": {x:0}, "100%": {x:120}, easeEach:"power2.out"}}, 2);';
  const before = parseGsapScriptAcorn(source).animations[0];
  if (!before) throw new Error("native animation parse failed");
  const mutation = markManualKeyframe({ type: "add-keyframe", properties: { x: 42 } });
  const changed = addKeyframeToScript(source, before.id, 50, { x: 42, data: "hf-manual-keyframe" });
  expect(mutation.properties).toEqual({ x: 42, data: "hf-manual-keyframe" });
  for (const parse of [parseGsapScriptAcorn, parseGsapScript]) {
    const anim = parse(changed).animations[0];
    expect(anim?.propertyGroup).toBe("position");
    expect(anim?.keyframes?.easeEach).toBe("power2.out");
    expect(anim?.keyframes?.keyframes.map((keyframe) => keyframe.percentage)).toEqual([0, 50, 100]);
    expect(animatedProps(anim ?? null)).toEqual(["x"]);
    usePlayerStore.setState({ elements: [{ id: "title", tag: "h1", start: 0, duration: 6, track: 1 }], keyframeCache: new Map() });
    if (!anim) throw new Error("round-trip animation missing");
    updateKeyframeCacheFromParsed([anim], "index.html", "title", { targetSelector: "#title" });
    const points = usePlayerStore.getState().keyframeCache.get("index.html#title")?.keyframes;
    expect(points?.map((keyframe) => keyframe.origin)).toEqual(["authored", "manual", "authored"]);
    expect(points?.map((keyframe) => keyframe.percentage)).toEqual([33.333, 58.333, 83.333]);
    expect(points?.[1]?.properties).toEqual({ x: 42 });
  }
});

test("merged property groups retain a manually recorded origin", () => {
  expect(deduplicateKeyframes([
    { percentage: 50, properties: { x: 42 }, origin: "authored" },
    { percentage: 50, properties: { opacity: 0.7 }, origin: "manual" },
  ])).toEqual([{ percentage: 50, properties: { x: 42, opacity: 0.7 }, origin: "manual" }]);
});

describe("resolveMotionTimelineTargetKeys", () => {
  test("maps selector-only semantic motion to the timeline row key", () => {
    expect(
      resolveMotionTimelineTargetKeys(
        { selector: ".status", hfId: "hf-status" },
        "index.html",
        [
          {
            id: "index.html:.status:0",
            key: "index.html:.status:0",
            hfId: "hf-status",
            selector: ".status",
            sourceFile: "index.html",
          },
        ],
      ),
    ).toEqual(["index.html:.status:0"]);
  });

  test("does not attach a same-named selector from another source file", () => {
    expect(
      resolveMotionTimelineTargetKeys(
        { selector: ".title" },
        "index.html",
        [
          {
            id: "nested.html:.title:0",
            key: "nested.html:.title:0",
            selector: ".title",
            sourceFile: "nested.html",
          },
        ],
      ),
    ).toEqual([]);
  });
});

describe("resolveGsapTimelineTargetKeys", () => {
  test("maps a selector-only tween to the exact timeline row key", () => {
    expect(
      resolveGsapTimelineTargetKeys(".status", "index.html", [
        {
          id: "hf-status",
          key: "index.html:.status:0",
          hfId: "hf-status",
          selector: ".status",
          sourceFile: "index.html",
        },
      ]),
    ).toEqual(["index.html:.status:0"]);
  });

  test("maps a data-hf-id tween without requiring a DOM id", () => {
    expect(
      resolveGsapTimelineTargetKeys('[data-hf-id="hf-card"]', "index.html", [
        {
          id: "hf-card",
          key: "index.html:[data-hf-id=hf-card]:0",
          hfId: "hf-card",
          selector: "[data-hf-id=hf-card]",
          sourceFile: "index.html",
        },
      ]),
    ).toEqual(["index.html:[data-hf-id=hf-card]:0"]);
  });

  test("falls back to a bare id before timeline discovery", () => {
    expect(resolveGsapTimelineTargetKeys("#headline", "index.html", [])).toEqual(["headline"]);
  });

  test("reconstructs the expanded DOM-child row key used by TimelineLanes", () => {
    expect(
      resolveGsapTimelineTargetKeys(".metric", "compositions/scene.html", [
        {
          id: "hf-metric",
          hfId: "hf-metric",
          selector: ".metric",
          selectorIndex: 0,
          sourceFile: "compositions/scene.html",
          hostId: "scene-host",
        },
      ]),
    ).toEqual(["scene-host::compositions/scene.html:.metric:0"]);
  });

  test("uses the host clip timing for an expanded selector-only child", () => {
    expect(
      resolveClipTimingBasis(
        "scene-host::compositions/scene.html:.metric:0",
        "compositions/scene.html",
        [{ id: "scene-host", domId: "scene-host", start: 4, duration: 6 }],
        [
          {
            id: "hf-metric",
            hostId: "scene-host",
            selector: ".metric",
            selectorIndex: 0,
            sourceFile: "compositions/scene.html",
          },
        ],
      ),
    ).toEqual({ elStart: 4, elDuration: 6 });
  });
});
