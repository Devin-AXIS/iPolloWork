import { describe, expect, test } from "bun:test";

import {
  buildDesignPreviewDocument,
  DESIGN_MESSAGE_CHANNEL,
  designSelectionStorageKey,
  isLocalHtmlPath,
} from "../src/react-app/domains/session/design/design-html-runtime";

describe("Design HTML runtime", () => {
  test("recognizes only HTML file paths", () => {
    expect(isLocalHtmlPath("index.html")).toBe(true);
    expect(isLocalHtmlPath("pages/LANDING.HTM")).toBe(true);
    expect(isLocalHtmlPath("index.html.ts")).toBe(false);
    expect(isLocalHtmlPath("https://example.com")).toBe(false);
  });

  test("leaves preview HTML untouched when editing is off", () => {
    const source = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    expect(buildDesignPreviewDocument(source, false)).toBe(source);
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

  test("scopes the remembered file to its workspace", () => {
    expect(designSelectionStorageKey("workspace-a")).not.toBe(designSelectionStorageKey("workspace-b"));
  });
});
