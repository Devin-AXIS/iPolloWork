import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Studio right panel layout", () => {
  it("combines layers and design while hiding slideshow and variables tabs", () => {
    const source = readFileSync(new URL("./StudioRightPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain('label={t("right.design")}');
    expect(source).toContain("<LayersPanel />");
    expect(source).toContain("{propertyPanel}");
    expect(source).not.toContain('label={t("right.layers")}');
    expect(source).not.toContain('label={t("right.slideshow")}');
    expect(source).not.toContain('label={t("right.variables")}');
  });

  it("labels the remaining queue as export", () => {
    const translations = readFileSync(new URL("../i18n.tsx", import.meta.url), "utf8");
    const header = readFileSync(new URL("./StudioHeader.tsx", import.meta.url), "utf8");

    expect(translations).toContain('"header.inspector": "Design"');
    expect(translations).toContain('"header.inspector": "设计"');
    expect(translations).toContain('"right.renders": "Export"');
    expect(translations).toContain('"right.renders": "导出"');
    expect(header).not.toContain('<circle cx="12" cy="12" r="10" />');
  });
});
