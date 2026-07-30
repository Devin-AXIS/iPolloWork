import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { buildExpandedElements } from "./useExpandedTimelineElements";

describe("expanded timeline hierarchy", () => {
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
      expandedDisplayHostKey: "index.html#scene",
      expandedParentStart: 2,
      start: 2,
      duration: 6,
    });
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
});
