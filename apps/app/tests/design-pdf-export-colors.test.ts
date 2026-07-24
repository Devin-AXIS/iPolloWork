import { describe, expect, test } from "bun:test";

import {
  colorDisplayP3ToSrgb,
  downgradeUnsupportedPdfExportColorText,
} from "../src/react-app/domains/session/design/pdf-export-colors";

describe("PDF export color compatibility", () => {
  test("downgrades CSS display-p3 color functions for html2canvas", () => {
    expect(colorDisplayP3ToSrgb("color(display-p3 0.5 0.25 1)")).toBe("rgb(128, 64, 255)");
    expect(colorDisplayP3ToSrgb("color(display-p3 1 0.5 0 / 0.25)")).toBe("rgba(255, 128, 0, 0.25)");
  });

  test("leaves surrounding CSS intact while replacing unsupported colors", () => {
    expect(colorDisplayP3ToSrgb(":root{--gray-a1:color(display-p3 0 0 0 / 0.05);color:#111}")).toBe(
      ":root{--gray-a1:rgba(0, 0, 0, 0.05);color:#111}",
    );
  });

  test("sanitizes colors in compound CSS before the export iframe parses it", () => {
    const source = `<style>
      .slide::before { box-shadow: 0 4px 20px color(display-p3 0 0 0 / 20%); }
      .hero { background: linear-gradient(color(srgb 1 0 0), color(display-p3 0 0 1)); }
    </style>`;
    const sanitized = downgradeUnsupportedPdfExportColorText(source);

    expect(sanitized).not.toMatch(/color\(\s*(?:display-p3|srgb)\b/i);
    expect(sanitized).toContain("rgba(0, 0, 0, 0.2)");
    expect(sanitized).toContain("rgb(255, 0, 0)");
    expect(sanitized).toContain("rgb(0, 0, 255)");
  });

});
