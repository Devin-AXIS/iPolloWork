import { describe, expect, test } from "vitest";
import {
  collectTimelineAncestorIds,
  resolveTimelineTreeSelectionId,
  resolveTimelineTreeSelectionKey,
  resolveStoryboardTimelineTarget,
} from "./timelineTreeSelection";
import { parseStoryboard } from "@hyperframes/core/storyboard";
import type { TimelineElement } from "../store/playerStore";

describe("script to official timeline correspondence", () => {
  const scene = (id: string, start: number, duration: number, overrides: Partial<TimelineElement> = {}): TimelineElement =>
    ({ id, domId: id, key: `index.html#${id}`, tag: "section", start, duration, track: 0, timingSource: "authored", ...overrides });
  const frames = parseStoryboard("## Frame 1 — Opening\n- duration: 5s\n\n## Frame 2 — Detail\n- duration: 6s\n").frames;

  test("locates a legacy script by unique frame-aligned scene bounds, regardless of array order", () => {
    const second = scene("detail", 5.01, 6.01);
    expect(resolveStoryboardTimelineTarget(frames[1], frames, [second, scene("opening", 0, 5)], 30)).toBe(second);
  });
  test("does not guess from row order, ambiguous bounds, or stale explicit bindings", () => {
    const second = scene("detail", 5, 6);
    expect(resolveStoryboardTimelineTarget(frames[1], frames, [scene("wrong", 12, 6)], 30)).toBeNull();
    expect(resolveStoryboardTimelineTarget(frames[1], frames, [second, scene("duplicate", 5, 6)], 30)).toBeNull();
    expect(resolveStoryboardTimelineTarget({ ...frames[1], extra: { scene_id: "deleted" } }, frames, [second], 30)).toBeNull();
    expect(resolveStoryboardTimelineTarget(frames[1], frames, [scene("wrapper", 5, 6, { timingSource: "implicit" })], 30)).toBeNull();
  });
  test("accepts a runtime media scene without mistaking matching audio or nested details for the shot", () => {
    const mediaScene = scene("detail", 5, 6, { tag: "img", timelineKind: "image" });
    const voice = scene("voice", 5, 6, { tag: "audio", src: "voice.mp3" });
    const child = scene("nested", 5, 6, { expandedParentStart: 5 });
    expect(resolveStoryboardTimelineTarget(frames[1], frames, [mediaScene, voice, child], 30)).toBe(mediaScene);
    expect(resolveStoryboardTimelineTarget(frames[1], frames, [voice, child], 30)).toBeNull();
  });
  test("resolves repeated component sources to their distinct hosts and rejects incomplete mappings", () => {
    const repeated = frames.map(frame => ({ ...frame, src: "./compositions/card.html" }));
    const first = scene("first", 0, 5, { compositionSrc: "compositions\\card.html" });
    const second = scene("second", 5, 6, { compositionSrc: "compositions/card.html" });
    expect(resolveStoryboardTimelineTarget(repeated[1], repeated, [second, first], 30)).toBe(second);
    expect(resolveStoryboardTimelineTarget(repeated[1], repeated, [first], 30)).toBeNull();
    expect(resolveStoryboardTimelineTarget({ ...repeated[1], extra: { scene_id: "first" } }, repeated, [second, first], 30)).toBe(first);
    const partiallyBound = [{ ...repeated[0], extra: { scene_id: "second" } }, repeated[1]];
    expect(resolveStoryboardTimelineTarget(partiallyBound[1], partiallyBound, [first, second], 30)).toBe(first);
    expect(resolveStoryboardTimelineTarget(repeated[1], repeated, [first, { ...second, start: 0 }], 30)).toBeNull();
  });
});

describe("timeline tree selection", () => {
  test("collects every ancestor from root to the selected node's parent", () => {
    expect(
      collectTimelineAncestorIds(
        "title",
        new Map([
          ["title", "hero"],
          ["hero", "scene"],
        ]),
      ),
    ).toEqual(["scene", "hero"]);
  });

  test("uses the nested source file key for a DOM-only child", () => {
    expect(
      resolveTimelineTreeSelectionKey({
        elementId: "title",
        sourceFile: "index.html",
        elements: [],
        manifest: [],
        domClipChildren: [
          {
            id: "title",
            parentId: "hero",
            hostId: "scene",
            label: "Title",
            sourceFile: "compositions/scene.html",
            stackingContextId: "root",
          },
        ],
      }),
    ).toBe("scene::compositions/scene.html#title");
  });

  test("does not select a same-id element from another composition", () => {
    const shared = { id: "title", domId: "title", tag: "h1", start: 0, duration: 3, track: 0 };
    expect(
      resolveTimelineTreeSelectionKey({
        elementId: "title",
        sourceFile: "compositions/second.html",
        elements: [
          { ...shared, key: "compositions/first.html#title", sourceFile: "compositions/first.html" },
          { ...shared, key: "compositions/second.html#title", sourceFile: "compositions/second.html" },
        ],
        manifest: [],
        domClipChildren: [],
      }),
    ).toBe("compositions/second.html#title");
  });

  test("resolves an id-less preview selection through its hf id and expands its parents", () => {
    const domClipChildren = [
      {
        id: "hf-title",
        hfId: "hf-title",
        parentId: "hero",
        hostId: "scene",
        label: "Title",
        sourceFile: "compositions/scene.html",
        selector: ".title",
        selectorIndex: 0,
        stackingContextId: "root",
      },
    ];
    const input = {
      hfId: "hf-title",
      sourceFile: "compositions/scene.html",
      elements: [],
      manifest: [],
      domClipChildren,
    };

    expect(resolveTimelineTreeSelectionId(input)).toBe("hf-title");
    expect(resolveTimelineTreeSelectionKey(input)).toBe(
      "scene::compositions/scene.html:.title:0",
    );
    expect(collectTimelineAncestorIds("hf-title", new Map([["hf-title", "hero"]]))).toEqual([
      "hero",
    ]);
  });

  test("resolves a selector-only preview element to its timeline tree identity", () => {
    const domClipChildren = [
      {
        id: "compositions/scene.html:h2:1",
        parentId: "hero",
        hostId: "scene",
        label: "H2",
        sourceFile: "compositions/scene.html",
        selector: "h2",
        selectorIndex: 1,
        stackingContextId: "root",
      },
    ];
    expect(
      resolveTimelineTreeSelectionId({
        sourceFile: "compositions/scene.html",
        selector: "h2",
        selectorIndex: 1,
        elements: [],
        manifest: [],
        domClipChildren,
      }),
    ).toBe("compositions/scene.html:h2:1");
  });

  test("maps a runtime data-hf-id back to the manifest row that owns that id", () => {
    expect(
      resolveTimelineTreeSelectionKey({
        hfId: "hf-logo",
        sourceFile: "index.html",
        elements: [
          {
            id: "hf-logo",
            key: "index.html:hf-logo:0",
            tag: "img",
            start: 0,
            duration: 8,
            track: 0,
          },
        ],
        manifest: [],
        domClipChildren: [],
      }),
    ).toBe("index.html:hf-logo:0");
  });

  test("keeps a runtime media selection on its enriched expanded timeline key", () => {
    expect(
      resolveTimelineTreeSelectionKey({
        elementId: "hf-logo",
        hfId: "hf-logo",
        sourceFile: "index.html",
        elements: [
          {
            id: "hf-logo",
            key: "index.html:hf-logo:0",
            tag: "img",
            start: 0,
            duration: 8,
            track: 0,
          },
        ],
        manifest: [],
        domClipChildren: [
          {
            id: "hf-logo",
            hfId: "hf-logo",
            parentId: "logo-wrap",
            hostId: "index.html:.logo-wrap:0",
            label: "Absolute",
            sourceFile: "index.html",
            selector: ".absolute",
            selectorIndex: 1,
            stackingContextId: "root",
          },
        ],
      }),
    ).toBe("index.html:.logo-wrap:0::index.html:.absolute:1");
  });
});
