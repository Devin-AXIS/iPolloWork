// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../player";
import { findMatchingTimelineElementId, findTimelineIdByAncestor } from "./studioHelpers";

test("matches a deleted timeline row by stable hf-id before a duplicated DOM id", () => {
  const elements: TimelineElement[] = [
    {
      id: "first",
      domId: "title",
      hfId: "hf-first",
      label: "First",
      tag: "h1",
      start: 0,
      duration: 3,
      track: 0,
    },
    {
      id: "second",
      domId: "title",
      hfId: "hf-second",
      label: "Second",
      tag: "h1",
      start: 0,
      duration: 3,
      track: 1,
    },
  ];

  expect(
    findMatchingTimelineElementId(
      { hfId: "hf-second", id: "title", sourceFile: "index.html" },
      elements,
    ),
  ).toBe("second");
});

describe("findTimelineIdByAncestor", () => {
  test("maps a static child to a selector-owned composition row", () => {
    document.body.innerHTML = `
      <main data-composition-id="opening-editorial-rise">
        <h1 data-hf-id="headline">Make ideas</h1>
      </main>
    `;
    const headline = document.querySelector("h1");
    const timelineElements: TimelineElement[] = [
      {
        id: "opening-editorial-rise",
        key: 'index.html:[data-composition-id="opening-editorial-rise"]:0',
        label: "opening-editorial-rise",
        tag: "main",
        selector: '[data-composition-id="opening-editorial-rise"]',
        start: 0,
        duration: 4.6,
        track: 0,
      },
    ];

    expect(findTimelineIdByAncestor(headline, timelineElements, "index.html")).toBe(
      'index.html:[data-composition-id="opening-editorial-rise"]:0',
    );
  });

  test("ignores a matching selector from another source file", () => {
    document.body.innerHTML = `
      <main data-composition-id="opening-editorial-rise">
        <h1>Make ideas</h1>
      </main>
    `;
    const headline = document.querySelector("h1");
    const timelineElements: TimelineElement[] = [
      {
        id: "opening-editorial-rise",
        label: "opening-editorial-rise",
        tag: "main",
        selector: '[data-composition-id="opening-editorial-rise"]',
        sourceFile: "scene.html",
        start: 0,
        duration: 4.6,
        track: 0,
      },
    ];

    expect(findTimelineIdByAncestor(headline, timelineElements, "index.html")).toBeNull();
  });
});
