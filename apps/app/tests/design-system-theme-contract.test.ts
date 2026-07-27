import { describe, expect, test } from "bun:test";
import {
  ensureHtmlDesignSystemContract,
  readAppliedDesignSystemId,
} from "../src/react-app/domains/session/design/design-system-theme-contract";

const registryPath = new URL(
  "../src/react-app/domains/session/design/design-system-registry.ts",
  import.meta.url,
);
const drawerPath = new URL(
  "../src/react-app/domains/session/design/design-system-drawer.tsx",
  import.meta.url,
);
const panelPath = new URL(
  "../src/react-app/domains/session/design/design-panel.tsx",
  import.meta.url,
);

describe("Design system theme contract", () => {
  test("emits persistent theme metadata and a high-priority compatibility layer", async () => {
    const source = await Bun.file(registryPath).text();

    expect(source).toContain("designSystemMarker(theme.id)");
    expect(source).toContain("html:root, html:root body, html:root [class]");
    expect(source).toContain("--bg: var(--ipw-color-bg) !important");
    expect(source).toContain("--accent: var(--ipw-color-primary) !important");
    expect(source).toContain("background-color: var(--ipw-card-bg) !important");
    expect(source).toContain("color: var(--ipw-color-on-primary) !important");
    expect(source).toContain(":where([data-ipw-slide], section.slide, .slide-frame) { background: var(--ipw-color-bg) !important");
    expect(source).not.toContain(".cover > *");
  });

  test("moves the shared token link after generated page styles and removes stale root token overrides", () => {
    const html = `<!doctype html><html data-ipw-design-system="old" style="--ipw-color-bg:#000; color-scheme:dark"><head><link rel="stylesheet" href="design-tokens.css"><style>.hero{background:#000!important}</style></head><body></body></html>`;
    const result = ensureHtmlDesignSystemContract(html, "bmw");

    expect(result).not.toContain("--ipw-color-bg:#000");
    expect(result).toContain('style="color-scheme:dark"');
    expect(result).toContain('data-ipw-design-system="bmw"');
    expect(result).toContain('href="design-tokens.css" data-ipw-design-tokens');
    expect(result.indexOf("data-ipw-design-tokens")).toBeGreaterThan(result.indexOf(".hero{background:#000!important}"));
  });

  test("reads the persisted applied theme from token CSS", () => {
    expect(readAppliedDesignSystemId("/* ipw-design-system: bmw */\n:root {}" )).toBe("bmw");
    expect(readAppliedDesignSystemId(":root {}" )).toBeNull();
  });

  test("renders only source tokens from the persisted current theme", async () => {
    const [drawer, panel] = await Promise.all([
      Bun.file(drawerPath).text(),
      Bun.file(panelPath).text(),
    ]);

    expect(drawer).toContain("currentThemeId");
    expect(drawer).toContain("buildDesignSystemTokenControls(selectedTheme)");
    expect(drawer).toContain("selectedThemeControls.map");
    expect(drawer).toContain("仅显示当前主题 tokens.css 中存在的变量。");
    expect(drawer).not.toContain("Gradient");
    expect(drawer).not.toContain("Background image");
    expect(drawer).not.toContain("Image overlay");
    expect(drawer).not.toContain("Glass effect");
    expect(panel).toContain("readAppliedDesignSystemId");
    expect(panel).toContain("currentThemeId={appliedDesignSystemId}");
    expect(panel).not.toContain('type: "set-token",\n      name,\n      value');
  });
});
