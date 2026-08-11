import { describe, expect, test } from "vitest";
import {
  timelineAnimationSourcesMatch,
  timelineElementMatchesDomSelection,
} from "./useTimelineEditCallbacks";

describe("timeline animation source guard", () => {
  test("uses the active composition for ordinary top-level selections", () => {
    expect(
      timelineAnimationSourcesMatch({
        activeCompPath: null,
        isExpanded: false,
      }),
    ).toBe(true);
  });

  test("fails closed when an expanded child selection has no source", () => {
    expect(
      timelineAnimationSourcesMatch({
        elementSourceFile: "scenes/intro.html",
        activeCompPath: "index.html",
        isExpanded: true,
      }),
    ).toBe(false);
  });

  test("normalizes preview URLs and rejects a different composition", () => {
    expect(
      timelineAnimationSourcesMatch({
        elementSourceFile: "scenes/intro.html",
        selectionSourceFile:
          "http://studio.local/preview/comp/scenes/intro.html",
        activeCompPath: "index.html",
        isExpanded: true,
      }),
    ).toBe(true);
    expect(
      timelineAnimationSourcesMatch({
        elementSourceFile: "scenes/intro.html",
        selectionSourceFile: "scenes/result.html",
        activeCompPath: "index.html",
        isExpanded: true,
      }),
    ).toBe(false);
  });
});

describe("timeline element selection identity", () => {
  test("matches selector-only expanded rows to the selected DOM element", () => {
    expect(
      timelineElementMatchesDomSelection(
        {
          id: ".status",
          selector: ".status",
          selectorIndex: 0,
        },
        {
          hfId: "hf-status",
          selector: ".status",
          selectorIndex: 0,
        },
      ),
    ).toBe(true);
  });

  test("keeps repeated selector rows isolated by selector index", () => {
    expect(
      timelineElementMatchesDomSelection(
        {
          id: ".item:1",
          selector: ".item",
          selectorIndex: 1,
        },
        {
          selector: ".item",
          selectorIndex: 0,
        },
      ),
    ).toBe(false);
  });
});
