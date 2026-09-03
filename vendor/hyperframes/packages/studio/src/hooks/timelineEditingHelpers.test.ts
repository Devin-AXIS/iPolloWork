import { Window } from "happy-dom";
import { describe, expect, test, vi } from "vitest";
import { applyPatchByTarget } from "../utils/sourcePatcher";
import {
  buildTimelineMoveTimingPatch,
  buildTimelineResizeTimingPatch,
  findTimelineElementInIframe,
  resolveTimelinePatch,
} from "./timelineEditingHelpers";
import { patchTimelineLayerStateInSource } from "./timelineTrackVisibility";
import { getEditableUnitSelectionTarget } from "../components/editor/domEditingElement";
import { resolveDomEditSelection } from "../components/editor/domEditingLayers";
import {
  buildOptimisticTimelineSplit,
  rollbackOptimisticTimelineSplit,
} from "../utils/timelineElementSplit";

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
  test("edits an explicitly authored composition unit as one host", async () => {
    const testWindow = new Window();
    const host = testWindow.document.createElement("div");
    host.id = "route-map";
    host.setAttribute("data-composition-id", "route-map");
    host.setAttribute("data-composition-src", "compositions/components/route-map.html");
    host.setAttribute("data-hf-edit-as-unit", "");
    const child = testWindow.document.createElement("div");
    host.append(child);
    testWindow.document.body.append(host);

    expect(getEditableUnitSelectionTarget(child)).toBe(host);
    await expect(
      resolveDomEditSelection(child, {
        activeCompositionPath: "index.html",
        isMasterView: true,
        skipSourceProbe: true,
      }),
    ).resolves.toMatchObject({
      element: host,
      sourceFile: "index.html",
      compositionSrc: "compositions/components/route-map.html",
      isCompositionHost: true,
    });
  });

  test("finds an inserted composition host by its manifest id when domId is absent", () => {
    const testWindow = new Window();
    const iframe = testWindow.document.createElement("iframe");
    const iframeDocument = testWindow.document;
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => iframeDocument,
    });
    const host = iframeDocument.createElement("div");
    host.id = "opening-editorial-rise";
    host.setAttribute("data-composition-id", "opening-editorial-rise");
    host.setAttribute("data-composition-src", "compositions/opening-editorial-rise.html");
    iframeDocument.body.append(host);
    expect(iframe.contentDocument).toBe(iframeDocument);

    expect(
      findTimelineElementInIframe(
        iframe,
        {
          id: "opening-editorial-rise",
          tag: "div",
          start: 1,
          duration: 4,
          track: 0,
          compositionSrc: "compositions/opening-editorial-rise.html",
        },
        "index.html",
      ),
    ).toBe(host);
  });

  test("splits the selected clip in memory before persistence and can roll it back", () => {
    const original = {
      id: "hero-video",
      key: "index.html::hero-video",
      domId: "hero-video",
      hfId: "hf-hero-video",
      selector: "#hero-video",
      tag: "video",
      start: 1,
      duration: 8,
      track: 2,
      playbackStart: 3,
      playbackRate: 1.5,
    };
    const unrelated = {
      id: "title",
      tag: "div",
      start: 0,
      duration: 2,
      track: 1,
    };

    const split = buildOptimisticTimelineSplit(
      [unrelated, original],
      original,
      4,
      "index.html::hero-video::pending-split-1",
    );

    expect(split?.elements).toHaveLength(3);
    expect(split?.elements[1]).toMatchObject({
      key: original.key,
      start: 1,
      duration: 3,
    });
    expect(split?.elements[2]).toMatchObject({
      key: "index.html::hero-video::pending-split-1",
      start: 4,
      duration: 5,
      playbackStart: 7.5,
      domId: undefined,
      hfId: undefined,
      selector: undefined,
    });

    const withConcurrentLabelEdit = split!.elements.map((element) =>
      element.id === "title" ? { ...element, label: "Updated title" } : element,
    );
    expect(rollbackOptimisticTimelineSplit(withConcurrentLabelEdit, split!)).toEqual([
      { ...unrelated, label: "Updated title" },
      original,
    ]);
  });

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
    const locked = patchTimelineLayerStateInSource(
      hidden ?? original,
      element,
      "timelineLocked",
      true,
    );
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
    const materialized = buildTimelineMoveTimingPatch(original, { id: "rw-thread" }, 2, 6, 3, true);

    expect(materialized).toContain(
      '<div id="rw-thread" data-start="2" data-duration="6" data-hf-preserve-flow="1" data-track-index="3">',
    );
    expect(materialized).toContain('data-composition-id="root" data-duration="8"');
    expect(buildTimelineMoveTimingPatch(materialized, { id: "rw-thread" }, 2, 6, 3, true)).toBe(
      materialized,
    );
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
    const patched = applyPatchByTarget(
      original,
      { id: "logo" },
      {
        type: "attribute",
        property: "start",
        value: "1",
      },
    );

    expect(patched).toContain('<img id="logo" src="logo.png" data-start="1" />');
    expect(patched).not.toContain("/ data-start");
  });
});
