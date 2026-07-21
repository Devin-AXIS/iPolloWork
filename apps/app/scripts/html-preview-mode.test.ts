import { describe, expect, it } from "bun:test";

import {
  htmlPreviewMode,
  inlineHtmlPreviewStylesheet,
  linkedHtmlPreviewStylesheetPath,
  slidePreviewScale,
} from "../src/react-app/domains/session/artifacts/html-preview-mode";

describe("htmlPreviewMode", () => {
  it("uses the scaled slide preview for template decks", () => {
    const templateDeck = `<!doctype html>
      <main class="deck" data-ipw-template-kind="slides">
        <section data-ipw-slide="1">Quarterly report</section>
      </main>`;

    expect(htmlPreviewMode(templateDeck)).toBe("slides");
    expect(htmlPreviewMode("<main data-ipw-template-kind=\"app\">Dashboard</main>")).toBe("document");
  });

  it("fits the fixed slide canvas within either preview dimension", () => {
    expect(slidePreviewScale(800, 900)).toBe(0.5);
    expect(slidePreviewScale(1600, 450)).toBe(0.5);
    expect(slidePreviewScale(0, 900)).toBe(0);
  });

  it("resolves and inlines a deck's local design token stylesheet", () => {
    const source = "<html><head><link rel=\"stylesheet\" href=\"design-tokens.css\"></head><body>Deck</body></html>";

    expect(linkedHtmlPreviewStylesheetPath("design/session/entry.html", source)).toBe("design/session/design-tokens.css");
    expect(inlineHtmlPreviewStylesheet(source, ":root { --ipw-color-accent: #c96442; }")).toContain("--ipw-color-accent: #c96442");
  });
});
