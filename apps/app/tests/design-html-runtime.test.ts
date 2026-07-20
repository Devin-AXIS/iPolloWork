import { describe, expect, test } from "bun:test";

import {
  buildDesignPreviewDocument,
  DESIGN_MESSAGE_CHANNEL,
  isLocalHtmlPath,
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

  test("keeps slide previews scrollable without injecting deck navigation by default", () => {
    const source = "<!doctype html><html><body><section class=\"slide is-active\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false, false, true);

    expect(preview).toContain('id="ipollowork-design-runtime"');
    expect(preview).not.toContain('id="ipollowork-design-deck-runtime"');
    expect(preview).toContain('type === "set-editing"');
    expect(preview).not.toContain("deck-navigate");
    expect(preview).not.toContain('visibilityStyle.id = "ipollowork-design-deck-runtime-style"');
  });

  test("injects the deck adapter only for fixed slide export mode", () => {
    const source = "<!doctype html><html><body><section class=\"slide is-active\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false, true, true);

    expect(preview).toContain('id="ipollowork-design-deck-runtime"');
    expect(preview).toContain("deck-navigate");
    expect(preview).toContain('data-ipw-slide');
    expect(preview).toContain('data-action=\'next\'');
    expect(preview).toContain('visibilityStyle.id = "ipollowork-design-deck-runtime-style"');
    expect(preview).toContain('clone.querySelector("#ipollowork-design-deck-runtime-style")?.remove()');
    expect(preview).toContain('[data-ipw-slide][aria-hidden="true"] { display: none !important; opacity: 0 !important; pointer-events: none !important; }');
    expect(preview).toContain('event.key === "ArrowRight"');
    expect(preview).toContain("isEditableTarget(event.target)");
    expect(preview).toContain('const slideWrappers = slides.map((slide) => slide.closest(".slide-wrap"))');
    expect(preview).toContain('const wrapperIndex = slideWrappers.findIndex((wrapper) => wrapper && !wrapper.classList.contains("hidden")');
    expect(preview).toContain("event.stopImmediatePropagation();");
  });

  test("treats a one-page canvas as a presentation so it can be exported", () => {
    const source = "<!doctype html><html><body><div class=\"slide-frame\"><h1>Only slide</h1></div></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false, true, true);

    expect(preview).toContain('document.querySelectorAll("[data-ipw-slide],section.slide,.slide,.slide-frame")');
    expect(preview).toContain("if (!slides.length)");
  });

  test("restores Chinese previous and next control aliases", async () => {
    const runtimePath = new URL(
      "../src/react-app/domains/session/design/design-html-runtime.ts",
      import.meta.url,
    );
    const runtimeSource = await Bun.file(runtimePath).text();

    expect(runtimeSource).toContain("[aria-label*='上一页']");
    expect(runtimeSource).toContain("[aria-label*='下一页']");
    expect(runtimeSource).not.toContain("[aria-label*='???']");
  });

  test("does not turn an ordinary one-section web page into a presentation", () => {
    const source = "<!doctype html><html><body><section class=\"slide\"><h1>Landing page section</h1></section></body></html>";
    const preview = buildDesignPreviewDocument(source, true);

    expect(preview).not.toContain('id="ipollowork-design-deck-runtime"');
  });

  test("scales compatible slide templates as a fixed 16:9 stage instead of triggering mobile reflow", () => {
    const source = "<!doctype html><html><body><main class=\"deck\"><section class=\"slide is-active\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></main></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false, true);

    expect(preview).toContain('id="ipollowork-design-fixed-slide-runtime"');
    expect(preview).toContain("sheet.deleteRule(index)");
    expect(preview).toContain("zoom: ${scale} !important");
    expect(preview).toContain("width: 1600px !important");
    expect(preview).toContain("window.requestAnimationFrame(applyScale)");
  });

  test("inlines template token CSS into the preview without treating it as user HTML", () => {
    const source = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    const preview = buildDesignPreviewDocument(source, true, ":root { --ipw-color-primary: #123456; }");
    expect(preview).toContain('id="ipollowork-design-template-token-style"');
    expect(preview).toContain("--ipw-color-primary: #123456");
    expect(preview).toContain("document-draft");
  });
});
