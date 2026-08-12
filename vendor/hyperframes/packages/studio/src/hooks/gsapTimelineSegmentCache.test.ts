import { describe, expect, test } from "vitest";
import {
  resolveGsapTimelineTargetKeys,
  resolveMotionTimelineTargetKeys,
} from "./gsapTimelineSegmentCache";
import { resolveClipTimingBasis } from "./useGsapTweenCache";

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
