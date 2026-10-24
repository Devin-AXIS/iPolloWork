import { getTimelineEditCapabilities } from "./timelineEditCapabilities";
import { normalizeToZones, toSceneLayerRows, toMasterSceneRows } from "./timelineZones";
import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  buildTimelineColorIndexes,
  presentFlatSceneLayers,
  resolveTimelineEditingMode,
  resolveTimelineBindingId,
  resolveTimelineClipLabel,
  resolveTimelineKind,
  resolveTimelineColorGroupKey,
  resolveTimelineLayerDepth,
  resolveTimelineLayerLabel,
  resolveTimelineLayerPrimaryElement,
  resolveTimelineLayerSourceTarget,
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
  test("shared lane controls follow the selected host before the playhead, then recover across gaps", () => {
    const first = element({ id: "first", key: "index.html#first" });
    const second = element({ id: "second", key: "index.html#second", start: 5 });
    expect(resolveTimelineLayerPrimaryElement([first, second], second.key!, 1)).toBe(second);
    expect(resolveTimelineLayerPrimaryElement([first, second], null, 5)).toBe(second);
    expect(resolveTimelineLayerPrimaryElement([first, second], "audio-other-lane", 7)).toBe(second);
    expect(resolveTimelineLayerPrimaryElement([first, second], null, 12)).toBe(first);
    expect(resolveTimelineLayerPrimaryElement([], null, 0)).toBeNull();
  });
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

  test("uses an independent clip caption without changing the tree label", () => {
    const clip = element({ label: "Tree node", clipLabel: "Edited clip caption" });
    expect(resolveTimelineLayerLabel([clip], 0)).toBe("Tree node");
    expect(resolveTimelineClipLabel(clip)).toBe("Edited clip caption");
  });

  test("keeps composition-row renames on the authored host file", () => {
    expect(
      resolveTimelineLayerSourceTarget(
        element({
          id: "opening-editorial-rise",
          domId: "opening-editorial-rise",
          hfId: "hf-host",
          selector: "#opening-editorial-rise",
          compositionSrc: "compositions/opening-editorial-rise.html",
        }),
        null,
      ),
    ).toEqual({
      id: "opening-editorial-rise",
      hfId: "hf-host",
      selector: "#opening-editorial-rise",
      selectorIndex: undefined,
      sourceFile: "index.html",
    });

    expect(
      resolveTimelineLayerSourceTarget(
        element({
          id: "nested-scene",
          sourceFile: "compositions\\parent.html",
          compositionSrc: "compositions/nested-scene.html",
        }),
        "index.html",
      ).sourceFile,
    ).toBe("compositions/parent.html");
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
      accent: "#1FBAC0",
      clip: "var(--hf-timeline-clip-bg)",
      clipActive: "var(--hf-timeline-clip-active)",
      border: "var(--hf-timeline-clip-border)",
      hover: "var(--hf-timeline-clip-hover)",
      dragging: "#1FBAC0",
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

describe("stable timeline lane identities", () => {
  test("preserves sparse authored tracks when another clip disappears", () => {
    const clips = [
      element({ id: "a", track: 0 }),
      element({ id: "b", track: 4 }),
      element({ id: "c", track: 8 }),
    ];
    expect(normalizeToZones(clips).map((clip) => clip.track)).toEqual([0, 4, 8]);
    expect(normalizeToZones(clips.slice(1)).map((clip) => clip.track)).toEqual([4, 8]);
  });
  test("legacy overlap remains accessible without shifting other authored tracks", () => {
    const clips = [
      element({ id: "a", track: 4 }),
      element({ id: "b", track: 4 }),
      element({ id: "c", track: 8 }),
    ];
    const result = normalizeToZones(clips);
    expect(result[0].track).not.toBe(result[1].track);
    expect(result[1].authoredTrack).toBe(4);
    expect(result[2].track).toBe(8);
    expect(normalizeToZones(result)).toEqual(result);
    expect(clips[1].track).toBe(4);
  });
  test("scene layers have individual rows while retaining source track identity", () => {
    const clips = [
      element({ id: "a", track: 4, zIndex: 1 }),
      element({ id: "b", track: 4, zIndex: 2 }),
    ];
    const result = toSceneLayerRows(clips);
    expect(result.map((clip) => clip.id)).toEqual(["b", "a"]);
    expect(result.map((clip) => clip.track)).toEqual([0, 1]);
    expect(result.every((clip) => clip.authoredTrack === 4 && clip.duration === 5)).toBe(true);
    expect(clips.map((clip) => clip.track)).toEqual([4, 4]);
  });
});

test("single-file works expose property rows while nested projects retain the master clip view", () => {
  expect(resolveTimelineEditingMode(1, [element()])).toBe("scene");
  expect(resolveTimelineEditingMode(1, [element({inlineScopeKind:"scene"})])).toBe("master");
  expect(resolveTimelineEditingMode(1, [element({inlineScopeKind:"group"})])).toBe("scene");
  expect(resolveTimelineEditingMode(2, [element({inlineScopeKind:"scene"})])).toBe("scene");
  expect(resolveTimelineEditingMode(1, [element({ compositionSrc: "scenes/one.html" })])).toBe(
    "master",
  );
  expect(resolveTimelineEditingMode(2, [element({ compositionSrc: "scenes/inner.html" })])).toBe(
    "scene",
  );
});

 test("overview keeps shared layers and gives each visual its own lane with one audio lane", () => {
   const clips = [element({id:"scene",inlineScopeKind:"scene",track:10}),
     element({id:"scene-next",inlineScopeKind:"scene",track:12,start:5}),
     element({id:"logo",track:0}),element({id:"music",tag:"audio",track:10}),
     element({id:"voice",tag:"audio",track:14,start:5})];
   const rows=toMasterSceneRows(clips);
   expect(rows.map((clip)=>clip.id)).toEqual(["scene","scene-next","logo","music","voice"]);
   expect(rows.map((clip)=>clip.track)).toEqual([0,1,2,3,3]);
   expect(rows.map((clip)=>clip.authoredTrack)).toEqual([10,12,0,10,14]);
   expect(rows.find((clip)=>clip.id==="logo")?.sharedLayer).toBe(true);
   expect(rows.filter((clip)=>clip.inlineScopeKind==="scene").every((clip)=>clip.sharedLayer===false)).toBe(true);
   expect(clips.every((clip)=>clip.sharedLayer===undefined)).toBe(true);
   expect(toSceneLayerRows(clips).filter((clip)=>clip.tag==="audio").map((clip)=>clip.track)).toEqual([3,3]);
   expect(clips.map((clip)=>clip.track)).toEqual([10,12,0,10,14]);
 });

 test("same-file group timing gestures stay guarded while external composition timing remains editable", () => {
   const scene=element({id:"alpha",domId:"alpha",inlineScopeKind:"scene"});
   expect(getTimelineEditCapabilities(scene)).toMatchObject({canMove:true,canTrimStart:false,canTrimEnd:false});
   expect(getTimelineEditCapabilities({...scene,compositionSrc:"compositions/alpha.html"})).toMatchObject({canMove:true,canTrimStart:true,canTrimEnd:true});
 });

 test("scene rows exclude shared edit layers without altering their source", () => {
 const clips=[element({id:"title",track:8}),element({id:"logo",track:12,sharedLayer:true}),element({id:"music",tag:"audio",track:5,sharedLayer:true})];
 expect(toSceneLayerRows(clips).map((clip)=>clip.id)).toEqual(["title"]);
 expect(clips.map((clip)=>clip.track)).toEqual([8,12,5]);
 });


test("flat scenes hide layout wrappers and retain animated groups with their child association", () => {
  const scene = element({ id: "scene", key: "index.html#scene", inlineScopeKind: "scene" });
  const layout = element({ id: "layout", timingSource: "implicit", inlineScopeKind: "group" });
  const card = element({ id: "card", key: "index.html#card", label: "Info Card", timingSource: "implicit", inlineScopeKind: "group" });
  const inner = element({ id: "inner", tag: "span", timingSource: "implicit" });
  const title = element({ id: "title", tag: "h1", timingSource: "implicit" });
  const picture = element({ id: "picture", tag: "img", timingSource: "implicit" });
  const surface = element({ id: "surface", timingSource: "implicit" });
  const rows = [scene, layout, card, inner, title, picture, surface];
  const parents = new Map([["layout", "scene"], ["card", "layout"], ["inner", "card"],
    ["title", "inner"], ["picture", "layout"], ["surface", "layout"]]);
  const dom = [{ id: "surface", parentId: "layout", hostId: "scene", label: "Surface", stackingContextId: "root", hasVisualContent: true }];
  const result = presentFlatSceneLayers(rows, parents, dom, new Set(["index.html#scene", "index.html#card"]), scene);
  expect(result.map(row => row.id)).toEqual(["card", "title", "picture", "surface"]);
  expect(result[0].sceneLayer?.role).toBe("group");
  expect(result[1].sceneLayer).toEqual({ role: "element", parentLabel: "Info Card" });
  expect(resolveTimelineLayerDepth([{ ...result[1], expandedParentStart: 4 }])).toBe(0);
  expect(toMasterSceneRows([scene])[0]).toMatchObject({ id: "scene", key: "index.html#scene" });
  expect(presentFlatSceneLayers(rows, parents, dom, new Set(), scene).map(row => row.id))
    .toEqual(["title", "picture", "surface"]);
  expect(rows.every(row => row.sceneLayer === undefined)).toBe(true);
});
