// @vitest-environment happy-dom

import { isEditableTarget } from "./timelineDiscovery";
import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../player";
import { resolveTimelineSelectionSeekTime, findMatchingTimelineElementId, findTimelineIdByAncestor, replaceVideoDocumentTitle } from "./studioHelpers";

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

describe("video document name", () => {
  test("changes only metadata and escapes markup", () => {
    const body = '<body><script>const x="$&";</script><div data-start="12">Original scene</div></body>';
    const source = '<html><head><title>Old</title><meta charset="utf-8"></head>' + body + '</html>';
    expect(replaceVideoDocumentTitle(source, " New <name> & $& ")).toBe('<html><head><title>New &lt;name&gt; &amp; $&amp;</title><meta charset="utf-8"></head>' + body + '</html>');
  });
  test("inserts absent title without replacing content", () => {
    expect(replaceVideoDocumentTitle("<head><style>x{}</style></head><body>keep</body>", "新名称")).toBe("<head><title>新名称</title><style>x{}</style></head><body>keep</body>");
  });
  test("rejects blank, overlong or malformed documents", () => {
    expect(() => replaceVideoDocumentTitle("<head></head>", "")).toThrow();
    expect(() => replaceVideoDocumentTitle("<head></head>", "x".repeat(121))).toThrow();
    expect(() => replaceVideoDocumentTitle("<body>keep</body>", "Name")).toThrow();
  });
});

describe("control keyboard ownership", () => {
  test.each([
    '<button><svg></svg></button>',
    '<div role="menu"><div role="menuitem"><span>Rotation</span></div></div>',
    '<div role="menuitemradio"><span>Selection</span></div>',
    '<div role="menuitemcheckbox"><span>Snap</span></div>',
    '<div role="listbox"><div role="option"><span>Ease</span></div></div>',
    '<div role="tab"><span>Animation</span></div>',
  ])("never nudges artwork while operating %s", (html) => {
    const host=document.createElement("div");host.innerHTML=html;
    expect(isEditableTarget(host.querySelector("svg, span"))).toBe(true);
    expect(isEditableTarget(host.firstElementChild)).toBe(true);
  });
  test("keeps canvas and layer-name arrows available for deliberate nudging", () => {
    const layer=document.createElement("div");layer.setAttribute("role","button");
    layer.className="hf-timeline-layer-header__select";
    expect(isEditableTarget(layer)).toBe(false);
    expect(isEditableTarget(document.createElement("h1"))).toBe(false);
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
  });
});

 test("inline scene navigation keeps its boundary while external clips retain their visible proof frame", () => {
  expect(resolveTimelineSelectionSeekTime(4,{start:4,duration:7,compositionSrc:"compositions/scene.html"})).toBe(7.5);
  expect(resolveTimelineSelectionSeekTime(4,{start:4,duration:7,inlineScopeKind:"scene"})).toBe(4);
  expect(resolveTimelineSelectionSeekTime(0,{start:4,duration:7,inlineScopeKind:"scene"})).toBe(4);
  expect(resolveTimelineSelectionSeekTime(4,{start:4,duration:7})).toBe(7.5);
});
