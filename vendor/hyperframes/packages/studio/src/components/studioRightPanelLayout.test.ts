import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Studio right panel layout", () => {
  it("combines layers and design while hiding slideshow and variables tabs", () => {
    const source = readFileSync(new URL("./StudioRightPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain('label={t("right.design")}');
    expect(source).toContain('label={t("right.catalog")}');
    expect(source).toContain('label={t("right.effects")}');
    expect(source).toContain('kind="animation"');
    expect(source).toContain('kind="effect"');
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

  it("keeps catalog controls fixed above an accessible persistent scroll region", () => {
    const catalog = readFileSync(new URL("./sidebar/BlocksTab.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../styles/studio.css", import.meta.url), "utf8");

    expect(catalog).toContain("flex h-full min-h-0 flex-1 flex-col overflow-hidden");
    expect(catalog).toContain("hf-block-catalog-scroll min-h-0 flex-1 px-2 pb-4");
    expect(catalog).toContain('data-testid="block-catalog-scroll"');
    expect(catalog).toContain("tabIndex={0}");
    expect(catalog).toContain('"Animation template list"');
    expect(catalog).toContain('"Effect template list"');
    expect(catalog).toContain('data-testid="block-catalog-card"');
    expect(styles).toContain(".hf-block-catalog-scroll {");
    expect(styles).toContain("overflow-y: scroll;");
    expect(styles).toContain("scrollbar-gutter: stable;");
    expect(styles).toContain(':root[data-ipollowork-theme="light"] .hf-block-catalog-scroll');
  });
});
