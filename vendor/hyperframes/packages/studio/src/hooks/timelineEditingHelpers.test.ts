import { Window } from "happy-dom";
import { describe, expect, test, vi } from "vitest";
import { applyPatchByTarget } from "../utils/sourcePatcher";
import {
  buildTimelineMoveTimingPatch,
  buildTimelineResizeTimingPatch,
  resolveTimelinePatch,
} from "./timelineEditingHelpers";
import { patchTimelineLayerStateInSource } from "./timelineTrackVisibility";

const SCENE_REPLAY = {
  id: "scene-replay",
  domId: "scene-replay",
};

vi.stubGlobal("DOMParser", new Window().DOMParser);

function moveSceneReplay(start: string) {
  return (html: string, target: Parameters<typeof applyPatchByTarget>[1]) =>
    applyPatchByTarget(html, target, {
      type: "attribute",
      property: "start",
      value: start,
    });
}

describe("timeline edit patch resolution", () => {
  test("persists visibility and lock state for authored timeline layers", () => {
    const original = '<main><div id="authored-layer"></div></main>';
    const element = {
      id: "authored-layer",
      domId: "authored-layer",
      tag: "div",
      start: 0,
      duration: 2,
      track: 0,
    };

    const hidden = patchTimelineLayerStateInSource(original, element, "hidden", true);
    expect(hidden).toContain('data-hidden=""');
    const locked = patchTimelineLayerStateInSource(hidden ?? original, element, "timelineLocked", true);
    expect(locked).toContain('data-timeline-locked=""');
    expect(
      patchTimelineLayerStateInSource(locked ?? original, element, "timelineLocked", false),
    ).not.toContain("data-timeline-locked");
  });

  test("treats runtime-generated timeline descendants as a non-persistable target", () => {
    const source = '<div id="caption-root"></div><script>word.id = "gl-w-" + i;</script>';
    expect(
      patchTimelineLayerStateInSource(
        source,
        {
          id: "gl-w-3",
          domId: "gl-w-3",
          tag: "span",
          start: 0,
          duration: 2,
          track: 0,
        },
        "hidden",
        true,
      ),
    ).toBeNull();
  });

  test("accepts an already-applied repeated drag as an unchanged success", () => {
    const original =
      '<html><body><section id="scene-replay" data-start="1" data-duration="2"></section></body></html>';
    const first = resolveTimelinePatch(original, SCENE_REPLAY, moveSceneReplay("2"));

    expect(first.status).toBe("changed");
    if (first.status !== "changed") return;
    expect(first.content).toContain('data-start="2"');

    const repeated = resolveTimelinePatch(first.content, SCENE_REPLAY, moveSceneReplay("2"));
    expect(repeated).toEqual({ status: "unchanged" });
  });

  test("still rejects a stale source target", () => {
    const original = '<html><body><section id="another-scene"></section></body></html>';
    expect(resolveTimelinePatch(original, SCENE_REPLAY, moveSceneReplay("2"))).toEqual({
      status: "target-not-found",
    });
  });

  test("materializes an implicit layer in one source patch", () => {
    const original =
      '<main data-composition-id="root" data-duration="6"><div id="rw-thread"></div></main>';
    const materialized = buildTimelineMoveTimingPatch(
      original,
      { id: "rw-thread" },
      2,
      6,
      3,
      true,
    );

    expect(materialized).toContain(
      '<div id="rw-thread" data-start="2" data-duration="6" data-hf-preserve-flow="1" data-track-index="3">',
    );
    expect(materialized).toContain('data-composition-id="root" data-duration="8"');
    expect(
      buildTimelineMoveTimingPatch(
        materialized,
        { id: "rw-thread" },
        2,
        6,
        3,
        true,
      ),
    ).toBe(materialized);
  });

  test("materializes track and flow layout when trimming an implicit layer", () => {
    const original =
      '<main data-composition-id="root" data-duration="6"><div id="rw-thread"></div></main>';
    const materialized = buildTimelineResizeTimingPatch(
      original,
      { id: "rw-thread" },
      {
        id: "rw-thread",
        tag: "div",
        start: 0,
        duration: 6,
        track: 3,
        timingSource: "implicit",
      },
      { start: 1, duration: 4 },
    );

    expect(materialized).toContain('data-start="1"');
    expect(materialized).toContain('data-duration="4"');
    expect(materialized).toContain('data-track-index="3"');
    expect(materialized).toContain('data-hf-preserve-flow="1"');
  });

  test("adds timing attributes before the slash of a self-closing logo", () => {
    const original = '<main><img id="logo" src="logo.png" /></main>';
    const patched = applyPatchByTarget(original, { id: "logo" }, {
      type: "attribute",
      property: "start",
      value: "1",
    });

    expect(patched).toContain('<img id="logo" src="logo.png" data-start="1" />');
    expect(patched).not.toContain('/ data-start');
  });
});
