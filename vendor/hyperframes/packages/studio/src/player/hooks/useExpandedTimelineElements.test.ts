import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";
import {
  applyTimelineLayerStateOverrides,
  buildExpandedElementTree,
  buildExpandedElements,
  buildInlineScopeElements,
  resolveTimelineExpansionRawId,
} from "./useExpandedTimelineElements";

describe("expanded timeline hierarchy", () => {
  test("inherits parent hiding without overwriting independently hidden descendants", () => {
    const elements: TimelineElement[] = [
      { id: "panel", tag: "div", start: 0, duration: 8, track: 0 },
      { id: "caption", tag: "p", start: 0, duration: 8, track: 0.25, compositionAncestors: ["panel"] },
      { id: "badge", tag: "span", start: 0, duration: 8, track: 0.5, hidden: true, compositionAncestors: ["panel"] },
      { id: "dot", tag: "span", start: 0, duration: 8, track: 0.75, compositionAncestors: ["panel", "badge"] },
      { id: "sibling", tag: "div", start: 0, duration: 8, track: 1 },
    ];
    const hidden = applyTimelineLayerStateOverrides(elements, new Map([["panel", { hidden: true }]]));
    expect(hidden.slice(0, 4).every((element) => element.hidden)).toBe(true);
    expect(hidden[4]?.hidden).not.toBe(true);

    const shown = applyTimelineLayerStateOverrides(elements, new Map([["panel", { hidden: false }]]));
    expect(shown[0]?.hidden).toBe(false);
    expect(shown[1]?.hidden).not.toBe(true);
    expect(shown[2]?.hidden).toBe(true);
    expect(shown[3]?.hidden).toBe(true);
    expect(elements[1]?.hidden).toBeUndefined();
  });

  test("applies session visibility and lock state to runtime-generated children", () => {
    const dynamicChild: TimelineElement = {
      id: "gl-w-3",
      key: "compositions/components/caption-glitch-rgb.html#gl-w-3",
      domId: "gl-w-3",
      tag: "span",
      start: 0,
      duration: 8,
      track: 0.5,
    };

    expect(
      applyTimelineLayerStateOverrides(
        [dynamicChild],
        new Map([[dynamicChild.key ?? dynamicChild.id, { hidden: true, timelineLocked: true }]]),
      )[0],
    ).toMatchObject({ hidden: true, timelineLocked: true });
  });

  test("resolves a clicked parent row instead of requiring a selected child", () => {
    const child: ClipManifestClip = {
      id: "title",
      label: "Scene title",
      start: 1,
      duration: 5,
      track: 0,
      kind: "element",
      tagName: "h1",
      compositionId: null,
      parentCompositionId: "scene",
      compositionSrc: null,
      assetUrl: null,
    };

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: "index.html#scene",
        isPlaying: false,
        currentTime: 0,
        manifest: [child],
        parentMap: new Map([["title", "scene"]]),
      }),
    ).toBe("scene");
  });

  test("keeps the parent row and inserts editable child rows beneath it", () => {
    const parent: TimelineElement = {
      id: "scene",
      domId: "scene",
      tag: "section",
      start: 0,
      duration: 8,
      track: 0,
      compositionSrc: "compositions/scene.html",
    };
    const child: ClipManifestClip = {
      id: "title",
      label: "Scene title",
      start: 1,
      duration: 5,
      track: 0,
      kind: "element",
      tagName: "h1",
      compositionId: null,
      parentCompositionId: "scene",
      compositionSrc: null,
      assetUrl: null,
      sourceFile: "compositions/scene.html",
    };

    const result = buildExpandedElements(
      [parent],
      [child],
      new Map([["title", "scene"]]),
      "scene",
      "scene",
    );

    expect(result.map((element) => element.id)).toEqual(["scene", "title"]);
    expect(result[1]).toMatchObject({
      label: "Scene title",
      expandedParentStart: 0,
      expandedDisplayHostKey: "scene",
      sourceFile: "compositions/scene.html",
    });
    expect(result[1]?.track).toBeGreaterThan(parent.track);
    expect(result[1]?.track).toBeLessThan(parent.track + 1);
  });

  test("stamps DOM-only child rows with the displayed host identity", () => {
    const parent: TimelineElement = {
      id: "scene",
      key: "index.html#scene",
      domId: "scene",
      tag: "section",
      start: 2,
      duration: 6,
      track: 0,
      compositionSrc: "compositions/scene.html",
    };

    const result = buildExpandedElements(
      [parent],
      [],
      new Map([["tool-pill", "scene"]]),
      "scene",
      "scene",
      [
        {
          id: "tool-pill",
          parentId: "scene",
          hostId: "scene",
          label: "Tool pill",
          tagName: "div",
          sourceFile: "compositions/scene.html",
        },
      ],
    );

    expect(result[1]).toMatchObject({
      id: "tool-pill",
      key: "scene::compositions/scene.html:tool-pill:0",
      previewHostId: "scene",
      expandedDisplayHostKey: "index.html#scene",
      expandedParentStart: 2,
      start: 2,
      duration: 6,
      timingSource: "implicit",
    });
  });

  test("keeps same-tag DOM children on distinct selector-index keys", () => {
    const parent: TimelineElement = {
      id: "brand",
      key: "index.html#brand",
      domId: "brand",
      tag: "section",
      start: 0,
      duration: 6,
      track: 0,
      compositionSrc: "compositions/brand.html",
    };
    const children = [0, 1].map((selectorIndex) => ({
      id: `compositions/brand.html:span:${selectorIndex}`,
      parentId: "brand",
      hostId: "brand",
      label: "span clip",
      tagName: "span",
      selector: "span",
      selectorIndex,
      sourceFile: "compositions/brand.html",
      stackingContextId: "root",
    }));

    const result = buildExpandedElements(
      [parent],
      [],
      new Map(children.map((child) => [child.id, child.parentId])),
      "brand",
      "brand",
      children,
    );

    expect(result.slice(1).map((element) => element.key)).toEqual([
      "brand::compositions/brand.html:span:0",
      "brand::compositions/brand.html:span:1",
    ]);
  });

  test("keeps the same authored child independently selectable in repeated hosts", () => {
    const parents: TimelineElement[] = ["file-one", "file-two"].map((id, track) => ({
      id,
      key: `index.html#${id}`,
      domId: id,
      tag: "section",
      start: 0,
      duration: 6,
      track,
      compositionSrc: "compositions/file.html",
    }));
    const children = parents.map((parent) => ({
      id: `${parent.id}-small`,
      parentId: parent.id,
      hostId: parent.id,
      label: "small clip",
      tagName: "small",
      selector: "small",
      selectorIndex: 0,
      sourceFile: "compositions/file.html",
      stackingContextId: "root",
    }));
    const parentMap = new Map(children.map((child) => [child.id, child.parentId]));

    const first = buildExpandedElements(
      parents,
      [],
      parentMap,
      "file-one",
      "file-one",
      children,
    );
    const second = buildExpandedElements(
      parents,
      [],
      parentMap,
      "file-two",
      "file-two",
      children,
    );

    expect(first[1]?.key).toBe("file-one::compositions/file.html:small:0");
    expect(second[2]?.key).toBe("file-two::compositions/file.html:small:0");
  });

  test("rebases stale manifest children immediately after a parent move", () => {
    const parent: TimelineElement = {
      id: "scene",
      domId: "scene",
      tag: "section",
      start: 2,
      duration: 8,
      track: 0,
      compositionSrc: "compositions/scene.html",
    };
    const manifestParent: ClipManifestClip = {
      id: "scene",
      label: "Scene",
      start: 0,
      duration: 8,
      track: 0,
      kind: "composition",
      tagName: "section",
      compositionId: "scene",
      parentCompositionId: null,
      compositionSrc: "compositions/scene.html",
      assetUrl: null,
    };
    const child: ClipManifestClip = {
      id: "title",
      label: "Scene title",
      start: 1,
      duration: 5,
      track: 0,
      kind: "element",
      tagName: "h1",
      compositionId: null,
      parentCompositionId: "scene",
      compositionSrc: null,
      assetUrl: null,
      sourceFile: "compositions/scene.html",
    };

    const result = buildExpandedElements(
      [parent],
      [manifestParent, child],
      new Map([["title", "scene"]]),
      "scene",
      "scene",
    );

    expect(result[1]).toMatchObject({
      id: "title",
      start: 3,
      duration: 5,
      expandedParentStart: 2,
      expandedDisplayHostKey: "scene",
    });
  });

  test("keeps ancestors visible when a nested layer is expanded", () => {
    const parent: TimelineElement = {
      id: "background",
      domId: "background",
      tag: "section",
      start: 0,
      duration: 15,
      track: 0,
      compositionSrc: "compositions/background.html",
    };
    const manifest: ClipManifestClip[] = [
      {
        id: "background",
        label: "Background Layer",
        start: 0,
        duration: 15,
        track: 0,
        kind: "composition",
        tagName: "section",
        compositionId: "background",
        parentCompositionId: null,
        compositionSrc: "compositions/background.html",
        assetUrl: null,
      },
      {
        id: "northstar",
        label: "Northstar Logo",
        start: 0,
        duration: 5,
        track: 0,
        kind: "composition",
        tagName: "div",
        compositionId: "northstar",
        parentCompositionId: "background",
        compositionSrc: "compositions/northstar.html",
        assetUrl: null,
      },
      {
        id: "image-reveal",
        label: "Img reveal",
        start: 0,
        duration: 4,
        track: 0,
        kind: "element",
        tagName: "img",
        compositionId: null,
        parentCompositionId: "northstar",
        compositionSrc: null,
        assetUrl: null,
      },
    ];

    const result = buildExpandedElementTree(
      [parent],
      manifest,
      new Map([
        ["northstar", "background"],
        ["image-reveal", "northstar"],
      ]),
      new Set(["background", "northstar"]),
    );

    expect(result.map((element) => element.id)).toEqual([
      "background",
      "northstar",
      "image-reveal",
    ]);
    expect(result[1]?.compositionAncestors).toEqual(["background"]);
    expect(result[2]?.compositionAncestors).toEqual(["background", "northstar"]);
    expect(result[1]?.track).toBeLessThan(result[2]?.track ?? 0);
  });

  test("merges timed and DOM-only children and expands every level", () => {
    const parent: TimelineElement = {
      id: "background",
      domId: "background",
      tag: "section",
      start: 0,
      duration: 15,
      track: 0,
      compositionSrc: "compositions/background.html",
    };
    const manifest: ClipManifestClip[] = [
      {
        id: "background",
        label: "Background Layer",
        start: 0,
        duration: 15,
        track: 0,
        kind: "composition",
        tagName: "section",
        compositionId: "background",
        parentCompositionId: null,
        compositionSrc: "compositions/background.html",
        assetUrl: null,
      },
      {
        id: "timed-title",
        label: "Timed title",
        start: 1,
        duration: 5,
        track: 0,
        kind: "element",
        tagName: "h1",
        compositionId: null,
        parentCompositionId: "background",
        compositionSrc: null,
        assetUrl: null,
      },
    ];
    const parentMap = new Map([
      ["timed-title", "background"],
      ["panel", "background"],
      ["badge", "panel"],
      ["dot", "badge"],
    ]);
    const domChildren = [
      {
        id: "panel",
        parentId: "background",
        hostId: "background",
        label: "Panel",
        tagName: "div",
        sourceFile: "compositions/background.html",
        stackingContextId: "root",
      },
      {
        id: "badge",
        parentId: "panel",
        hostId: "background",
        label: "Badge",
        tagName: "div",
        sourceFile: "compositions/background.html",
        stackingContextId: "root",
      },
      {
        id: "dot",
        parentId: "badge",
        hostId: "background",
        label: "Dot",
        tagName: "span",
        sourceFile: "compositions/background.html",
        stackingContextId: "root",
      },
    ];

    const expanded = buildExpandedElementTree(
      [parent],
      manifest,
      parentMap,
      new Set(["background", "panel", "badge"]),
      domChildren,
    );
    expect(expanded.map((element) => element.id)).toEqual([
      "background",
      "timed-title",
      "panel",
      "badge",
      "dot",
    ]);
    expect(expanded.at(-1)?.compositionAncestors).toEqual(["background", "panel", "badge"]);
    expect(expanded.find((element) => element.id === "timed-title")?.timingSource).toBe("authored");
    expect(expanded.find((element) => element.id === "panel")?.timingSource).toBe("implicit");
    expect(expanded.find((element) => element.id === "badge")?.timingSource).toBe("implicit");

    const collapsedAtPanel = buildExpandedElementTree(
      [parent],
      manifest,
      parentMap,
      new Set(["background"]),
      domChildren,
    );
    expect(collapsedAtPanel.map((element) => element.id)).toEqual([
      "background",
      "timed-title",
      "panel",
    ]);
  });
});

 test("inline scopes preserve source times and show only their own direct children", () => {
   const scene: TimelineElement={id:"alpha",domId:"alpha",key:"index.html#alpha",tag:"section",start:2,duration:6,track:10,inlineScopeKind:"scene",sourceFile:"index.html"};
   const logo: TimelineElement={id:"logo",domId:"logo",tag:"div",start:0,duration:18,track:20};
   const children: import("../store/playerStore").DomClipChild[] = [{id:"group",domId:"group",parentId:"alpha",hostId:"alpha",label:"Group",tagName:"div",stackingContextId:"root",inlineScopeKind:"group"},{id:"title",domId:"title",parentId:"group",hostId:"alpha",label:"Title",tagName:"h1",stackingContextId:"root"}];
   const map=new Map([["group","alpha"],["title","group"]]);
   const result=buildInlineScopeElements([scene,logo],[],map,children,scene);
   expect(result.map((row)=>row.id)).toEqual(["alpha","group"]);
   expect(result[1]).toMatchObject({start:2,duration:6,key:"index.html#group",inlineScopeKind:"group",sourceFile:"index.html",expandedParentStart:undefined,compositionSrc:undefined});
   const nested=buildInlineScopeElements([scene,logo],[],map,children,result[1]);
   expect(nested.map((row)=>row.id)).toEqual(["group","title"]);
   expect(nested[1]).toMatchObject({start:2,duration:6,expandedParentStart:undefined});
   expect(scene.track).toBe(10);
 });


test("flat scene descendants preserve stable source keys, authored timing and external boundaries", () => {
  const scene: TimelineElement = { id: "alpha", domId: "alpha", key: "index.html#alpha",
    tag: "section", start: 8, duration: 8, track: 3, sourceFile: "index.html", inlineScopeKind: "scene" };
  const title: TimelineElement = { id: "title", domId: "title", key: "index.html#title",
    tag: "h1", start: 10, duration: 2, track: 9, authoredTrack: 9, sourceFile: "index.html" };
  const children = [
    { id: "layout", parentId: "alpha", hostId: "alpha", label: "Layout", tagName: "div", stackingContextId: "root" },
    { id: "card", parentId: "layout", hostId: "alpha", label: "Card", tagName: "div", stackingContextId: "root" },
    { id: "title", parentId: "card", hostId: "alpha", label: "Title", tagName: "h1", stackingContextId: "root" },
    { id: "other", parentId: "beta", hostId: "beta", label: "Other", tagName: "h1", stackingContextId: "root" },
  ];
  const map = new Map(children.map(child => [child.id, child.parentId]));
  const snapshot = JSON.stringify({ scene, title, children });
  const rows = buildInlineScopeElements([scene, title], [], map, children, scene, true);
  expect(rows.map(row => row.id)).toEqual(["alpha", "layout", "card", "title"]);
  expect(rows.at(-1)).toMatchObject({ key: "index.html#title", start: 10, duration: 2,
    authoredTrack: 9, expandedParentStart: undefined, sourceFile: "index.html" });
  expect(rows[2]).toMatchObject({ start: 8, duration: 8 });
  expect(JSON.stringify({ scene, title, children })).toBe(snapshot);
  map.set("layout", "title");
  expect(buildInlineScopeElements([scene], [], map, children, scene, true).length).toBeLessThanOrEqual(4);
});
