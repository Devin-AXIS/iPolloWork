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

  test("describes an editable element with a stable CSS locator", () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><section><h1>Title</h1></section></body></html>", true);
    expect(preview).toContain("const elementLocator = (element: HTMLElement)");
    expect(preview).toContain("nth-of-type");
    expect(preview).toContain("locator: elementLocator(element)");
  });

  test("keeps locators stable after editor-only control labels are unwrapped", () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><button>Save<span>Now</span></button></body></html>", true);
    expect(preview).toContain('element.hasAttribute("data-ipollowork-design-text-node") ? element.parentElement : element');
    expect(preview).toContain('!sibling.hasAttribute("data-ipollowork-design-text-node")');
  });

  test("keeps a dormant editor bridge and deck adapter in the same preview document", () => {
    const source = "<!doctype html><html><body><section class=\"slide is-active\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false, false, true);

    expect(preview).toContain('id="ipollowork-design-runtime"');
    expect(preview).toContain('id="ipollowork-design-deck-runtime"');
    expect(preview).toContain('type === "set-editing"');
    expect(preview).toContain("deck-navigate");
    expect(preview).toContain('data-ipw-slide');
    expect(preview).toContain('data-action=\'next\'');
    expect(preview).toContain('visibilityStyle.id = "ipollowork-design-deck-runtime-style"');
    expect(preview).toContain('[data-ipw-slide][aria-hidden="true"] { display: none !important; opacity: 0 !important; pointer-events: none !important; }');
    expect(preview).toContain('event.key === "ArrowRight"');
    expect(preview).toContain("isEditableTarget(event.target)");
    expect(preview).toContain('const slideWrappers = slides.map((slide) => slide.closest(".slide-wrap"))');
    expect(preview).toContain('const wrapperIndex = slideWrappers.findIndex((wrapper) => wrapper && !wrapper.classList.contains("hidden")');
    expect(preview).toContain("event.stopImmediatePropagation();");
  });

  test("treats a one-page canvas as a presentation so it can be exported", () => {
    const source = "<!doctype html><html><body><div class=\"slide-frame\"><h1>Only slide</h1></div></body></html>";
    const preview = buildDesignPreviewDocument(source, true, "", false, false, true);

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

  test("supports text-only div editing and toolbar deletion without keyboard deletion", () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><div>Metric</div></body></html>", true, "", false, false, true);

    expect(preview).toContain('element.tagName === "DIV"');
    expect(preview).toContain("element.children.length === 0");
    expect(preview).toContain("Boolean(element.textContent?.trim())");
    expect(preview).toContain('data.type === "delete"');
    expect(preview).toContain("canDeleteElement(selected)");
    expect(preview).toContain("selected.remove()");
    expect(preview).toContain('type: "zoom"');
    expect(preview).not.toContain('event.key === "Delete"');
    expect(preview).not.toContain('event.key === "Backspace"');
  });

  test("keeps the selection overlay from blocking clicks on text inside a selected card", () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><div class=\"card\"><h4>Card title</h4><p>Card body</p></div></body></html>", true);

    expect(preview).toContain('#ipollowork-design-transform-overlay { position: fixed; z-index: 2147483646; display: none; pointer-events: none;');
    expect(preview).toContain('#ipollowork-design-transform-overlay [data-handle] {');
    expect(preview).toContain('pointer-events: auto;');
  });

  test("does not select a presentation slide root for transform", () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><section class=\"slide\"><h1>Slide title</h1></section></body></html>", true, "", false, false, true);

    expect(preview).toContain("presentationCanvas && element.matches(\"[data-ipw-slide],section.slide,.slide,.slide-frame\")");
    expect(preview).toContain("!isPresentationRoot(element)");
    expect(preview).toContain("slideRoot && !slideRoot.contains(element)");
    expect(preview).toContain("isPresentationSlideRoot(element)");
    expect(preview).toContain("],false,false,true);");
  });

  test("reports a drag on empty presentation canvas space as a pan", () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><section class=\"slide\"><h1>Slide title</h1></section></body></html>", true, "", false, false, true);

    expect(preview).toContain('type: "pan"');
    expect(preview).toContain("canvasPan");
    expect(preview).toContain("selectionCandidate(target)");
  });

  test("clears the editor selection on blank canvas clicks and slide navigation", async () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><section class=\"slide\"><h1>One</h1></section><section class=\"slide\"><h1>Two</h1></section></body></html>", true, "", true, false, true);
    const runtimePath = new URL(
      "../src/react-app/domains/session/design/design-html-runtime.ts",
      import.meta.url,
    );
    const runtimeSource = await Bun.file(runtimePath).text();

    expect(preview).toContain('type: "deselected"');
    expect(preview).toContain("clearSelection(!0)");
    expect(preview).toContain("ipollowork-design-deck-navigated");
    expect(runtimeSource).toContain("if (isDeckControl) notifyNavigation();");
  });

  test("intercepts Ctrl or Meta wheel zoom only for presentation canvases", () => {
    const sitePreview = buildDesignPreviewDocument("<!doctype html><html><body><h1>Site</h1></body></html>", true, "", false, false, false);
    const presentationPreview = buildDesignPreviewDocument("<!doctype html><html><body><section class=\"slide\"><h1>Slide</h1></section></body></html>", true, "", false, false, true);

    expect(sitePreview).toContain("if (!presentationCanvas || !event.ctrlKey && !event.metaKey)");
    expect(sitePreview).toContain("],false,false,false);</script>");
    expect(presentationPreview).toContain("],false,false,true);</script>");
    expect(presentationPreview).toContain('type: "zoom"');
  });
});
