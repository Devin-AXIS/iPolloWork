import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Studio right panel layout", () => {
  it("combines layers and design while hiding slideshow and variables tabs", () => {
    const source = readFileSync(new URL("./StudioRightPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain('label={t("right.design")}');
    expect(source).toContain('label={t("right.catalog")}');
    expect(source).toContain('label={t("right.effects")}');
    expect(source).toContain('page="animation"');
    expect(source).toContain('page="scene"');
    expect(source).toContain("<LayersPanel />");
    expect(source).toContain("{propertyPanel}");
    expect(source).not.toContain("<PreviewFullscreenButton />");
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
    expect(translations).toContain('"right.catalog": "Animation"');
    expect(translations).toContain('"right.catalog": "动画"');
    expect(translations).toContain('"right.effects": "Scenes"');
    expect(translations).toContain('"right.effects": "场景"');
    expect(header).not.toContain('<circle cx="12" cy="12" r="10" />');
  });

  it("keeps search fixed above two independent four-column scroll regions", () => {
    const catalog = readFileSync(new URL("./sidebar/BlocksTab.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../styles/studio.css", import.meta.url), "utf8");

    expect(catalog).toContain("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden");
    expect(catalog).toContain("grid-rows-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(catalog).toContain('data-testid="block-catalog-search"');
    expect(catalog).toContain("hf-block-catalog-scroll min-h-0 min-w-0 flex-1 overscroll-contain");
    expect(catalog).toContain("grid-cols-4");
    expect(catalog).toContain("new IntersectionObserver");
    expect(catalog).toContain("{ root: scrollRoot, threshold: 0.05 }");
    expect(catalog).toContain('import("./blockPreviewRuntime")');
    expect(catalog).toContain("setTimeout(startPreview, 150)");
    expect(catalog).toContain("tabIndex={0}");
    expect(catalog).toContain('data-testid="block-catalog-card"');
    expect(styles).toContain(".hf-block-catalog-scroll {");
    expect(styles).toContain("overflow-y: scroll;");
    expect(styles).toContain("scrollbar-gutter: stable;");
    expect(styles).toContain("scrollbar-width: thin;");
    expect(styles).toContain(':root[data-ipollowork-theme="light"] .hf-block-catalog-scroll');
  });
});
