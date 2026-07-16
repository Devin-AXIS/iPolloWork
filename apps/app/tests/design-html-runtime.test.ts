import { describe, expect, test } from "bun:test";

import {
  buildDesignPreviewDocument,
  DESIGN_MESSAGE_CHANNEL,
  designDeckFitScale,
  designDeckDirectionForKey,
  designPreviewFitScale,
  isLocalHtmlPath,
  shouldRunDesignDeckRuntime,
} from "../src/react-app/domains/session/design/design-html-runtime";

describe("Design HTML runtime", () => {
  test("recognizes only HTML file paths", () => {
    expect(isLocalHtmlPath("index.html")).toBe(true);
    expect(isLocalHtmlPath("pages/LANDING.HTM")).toBe(true);
    expect(isLocalHtmlPath("index.html.ts")).toBe(false);
    expect(isLocalHtmlPath("https://example.com")).toBe(false);
  });

  test("keeps navigation active without injecting editor controls when editing is off", () => {
    const source = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    const preview = buildDesignPreviewDocument(source, false);
    expect(preview).toContain('id="ipollowork-design-navigation-runtime"');
    expect(preview).not.toContain('id="ipollowork-design-runtime"');
    expect(preview).toContain("<h1>Hello</h1>");
  });

  test("injects the isolated editor bridge before the closing body", () => {
    const source = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    const preview = buildDesignPreviewDocument(source, true);

    expect(preview).toContain('id="ipollowork-design-runtime"');
    expect(preview).toContain(DESIGN_MESSAGE_CHANNEL);
    expect(preview.indexOf("ipollowork-design-runtime")).toBeLessThan(preview.toLowerCase().lastIndexOf("</body>"));
    expect(preview).toContain("h1,h2,h3,h4,h5,h6,p,span,a,button,label,li,blockquote");
    expect(preview).toContain('addEventListener("dblclick"');
    expect(preview).toContain('setAttribute("contenteditable", "true")');
    expect(preview).toContain("getBoundingClientRect");
    expect(preview).toContain('data-ipollowork-design-editing');
    expect(preview).toContain('data.scope === "range"');
    expect(preview).toContain("textRange.extractContents()");
    expect(preview).toContain("rangeText");
    expect(preview).toContain("colorField");
    expect(preview).toContain("backgroundColor");
    expect(preview).toContain("ipollowork-design-transform-overlay");
    expect(preview).toContain('data-handle="se"');
    expect(preview).toContain('prepareTransform(selected, handle === "move" ? "move" : "resize"');
    expect(preview).toContain('selected.style.width = `${width}px`');
  });

  test("keeps a dormant editor bridge and deck adapter in the same preview document", () => {
    const source = "<!doctype html><html><body><section class=\"slide is-active\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false);

    expect(preview).toContain('id="ipollowork-design-runtime"');
    expect(preview).toContain('id="ipollowork-design-deck-runtime"');
    expect(preview).toContain('type === "set-editing"');
    expect(preview).toContain("deck-navigate");
    expect(preview).toContain('data-ipw-slide');
    expect(preview).toContain('data-action=\'next\'');
  });

  test("normalizes deck keyboard navigation across arrow directions", () => {
    expect(designDeckDirectionForKey("ArrowLeft")).toBe("previous");
    expect(designDeckDirectionForKey("ArrowUp")).toBe("previous");
    expect(designDeckDirectionForKey("PageUp")).toBe("previous");
    expect(designDeckDirectionForKey("ArrowRight")).toBe("next");
    expect(designDeckDirectionForKey("ArrowDown")).toBe("next");
    expect(designDeckDirectionForKey("PageDown")).toBe("next");
    expect(designDeckDirectionForKey(" ")).toBe("next");
    expect(designDeckDirectionForKey("Enter")).toBeNull();
  });

  test("injects the unified keyboard navigation map into deck previews", () => {
    const source = "<!doctype html><html><body><section class=\"slide is-active\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false);

    expect(preview).toContain("ArrowUp");
    expect(preview).toContain("ArrowDown");
    expect(preview).toContain("event.preventDefault()");
    expect(preview).toContain("directionForKey(event.key)");
  });

  test("does not treat ordinary website slide classes as deck previews", () => {
    expect(shouldRunDesignDeckRuntime({
      slideCount: 9,
      dataSlideCount: 0,
      explicitDeckContainer: false,
      deckControlCount: 0,
    })).toBe(false);
    expect(shouldRunDesignDeckRuntime({
      slideCount: 2,
      dataSlideCount: 2,
      topLevelSectionSlideCount: 0,
      explicitDeckContainer: false,
      deckControlCount: 0,
    })).toBe(true);
    expect(shouldRunDesignDeckRuntime({
      slideCount: 6,
      dataSlideCount: 0,
      topLevelSectionSlideCount: 6,
      explicitDeckContainer: false,
      deckControlCount: 0,
    })).toBe(true);
    expect(shouldRunDesignDeckRuntime({
      slideCount: 2,
      dataSlideCount: 0,
      topLevelSectionSlideCount: 0,
      explicitDeckContainer: true,
      deckControlCount: 0,
    })).toBe(true);
    expect(shouldRunDesignDeckRuntime({
      slideCount: 2,
      dataSlideCount: 0,
      topLevelSectionSlideCount: 0,
      explicitDeckContainer: false,
      deckControlCount: 1,
    })).toBe(true);
  });

  test("scales fixed-width deck canvases down to the preview viewport", () => {
    expect(designDeckFitScale(1024, 810)).toBe(1);
    expect(designDeckFitScale(760, 720, 690, 680)).toBe(1);
    expect(designDeckFitScale(760, 810)).toBeCloseTo(0.9185, 4);
    expect(designDeckFitScale(760, 810, 690, 1080)).toBeCloseTo(0.6241, 4);
    expect(designDeckFitScale(390, 810)).toBeCloseTo(0.4617, 4);
  });

  test("scales overflowing website canvases down by width in the preview", () => {
    expect(designPreviewFitScale(1180, 1180)).toBe(1);
    expect(designPreviewFitScale(760, 1180)).toBeCloseTo(0.6305, 4);
    expect(designPreviewFitScale(390, 1180)).toBeCloseTo(0.3169, 4);
  });

  test("scales fixed artboards by both width and height in the preview", () => {
    expect(designPreviewFitScale(760, 1080, 690, 1920, "artboard")).toBeCloseTo(0.351, 3);
    expect(designPreviewFitScale(1200, 1080, 900, 720, "artboard")).toBe(1);
  });

  test("injects generic preview fitting without saving it as user markup", () => {
    const source = "<!doctype html><html data-ipw-frame=\"fluid\"><body><main style=\"width:1180px\"><h1>Wide site</h1></main></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false);

    expect(preview).toContain('id="ipollowork-design-preview-fit-runtime"');
    expect(preview).toContain("ipollowork-design-preview-fit-style");
    expect(preview).toContain("data-ipw-design-preview-fit-target");
    expect(preview).toContain("--ipw-design-preview-fit-scale");
    expect(preview).toContain("overflow-x");
    expect(preview).toContain("fallbackTimer");
    expect(preview).toContain("window.setTimeout(scheduleFit, 180)");
    expect(preview).toContain('removeAttribute("data-ipw-design-preview-fit-target")');
    expect(preview).toContain('removeAttribute("data-ipw-design-preview-fit")');
  });

  test("injects deck canvas fitting into previews without saving it as user markup", () => {
    const source = "<!doctype html><html><body><div class=\"deck\"><section class=\"slide is-active\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></div></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false);

    expect(preview).toContain("ipollowork-design-deck-fit-style");
    expect(preview).toContain("data-ipw-design-deck-fit-target");
    expect(preview).toContain("--ipw-design-deck-fit-scale");
    expect(preview).toContain("zoom:");
    expect(preview).toContain('removeAttribute("data-ipw-design-deck-fit-target")');
  });

  test("inlines template token CSS into the preview without treating it as user HTML", () => {
    const source = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    const preview = buildDesignPreviewDocument(source, true, ":root { --ipw-color-primary: #123456; }");
    expect(preview).toContain('id="ipollowork-design-template-token-style"');
    expect(preview).toContain("--ipw-color-primary: #123456");
    expect(preview).toContain("document-draft");
  });
});
