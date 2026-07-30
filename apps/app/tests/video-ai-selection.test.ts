import { describe, expect, test } from "bun:test";

import { resolveVideoAiSelectionTarget } from "../src/react-app/domains/session/video/video-ai-selection";

describe("Video Ask AI selection target", () => {
  test("prefers the stable HyperFrames id over generated selectors", () => {
    expect(resolveVideoAiSelectionTarget({
      file: "index.html",
      hfId: "scene-title",
      id: "title",
      selector: "h1.title",
    })).toEqual({
      file: "index.html",
      locator: '[data-hf-id="scene-title"]',
    });
  });

  test("falls back to DOM id and then selector", () => {
    expect(resolveVideoAiSelectionTarget({
      file: "scenes/intro.html",
      id: "intro-title",
    })).toEqual({
      file: "scenes/intro.html",
      locator: '[id="intro-title"]',
    });
    expect(resolveVideoAiSelectionTarget({
      selector: ".scene-title",
    })).toEqual({
      file: "index.html",
      locator: ".scene-title",
    });
  });

  test("escapes attribute locators and rejects unsafe or missing targets", () => {
    expect(resolveVideoAiSelectionTarget({
      hfId: 'title"primary',
    })?.locator).toBe('[data-hf-id="title\\"primary"]');
    expect(resolveVideoAiSelectionTarget({
      file: "../outside.html",
      hfId: "title",
    })).toBeNull();
    expect(resolveVideoAiSelectionTarget({
      file: "C:\\outside.html",
      hfId: "title",
    })).toBeNull();
    expect(resolveVideoAiSelectionTarget({
      file: "https://example.com/index.html",
      hfId: "title",
    })).toBeNull();
    expect(resolveVideoAiSelectionTarget({
      file: "index.html",
    })).toBeNull();
  });
});
