import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";
import {
  applyTimelineLayerStateOverrides,
  buildExpandedElementTree,
  buildExpandedElements,
  resolveTimelineExpansionRawId,
} from "./useExpandedTimelineElements";

describe("expanded timeline hierarchy", () => {
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
          label: "Tool pill",
          tagName: "div",
          sourceFile: "compositions/scene.html",
        },
      ],
    );

    expect(result[1]).toMatchObject({
      id: "tool-pill",
      key: "compositions/scene.html:tool-pill:0",
      expandedDisplayHostKey: "index.html#scene",
      expandedParentStart: 2,
      start: 2,
      duration: 6,
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
      "compositions/brand.html:span:0",
      "compositions/brand.html:span:1",
    ]);
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
