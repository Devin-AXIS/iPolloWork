import { describe, expect, test } from "bun:test";
import {
  ensureHtmlDesignSystemContract,
  readAppliedDesignSystemId,
} from "../src/react-app/domains/session/design/design-system-theme-contract";
import {
  linkedDesignTokenPath,
  mergeTemplateTokenCss,
  parseDesignTokenValues,
  replaceDesignTokenValue,
} from "../src/react-app/domains/session/design/design-system-files";

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
    expect(source).toContain("border-radius: var(--ipw-card-radius) !important");
    expect(source).toContain("box-shadow: var(--ipw-card-shadow) !important");
    expect(source).not.toContain(":where(button, [role=\"button\"], [class*=\"button\"], [class*=\"btn\"])");
    expect(source).toContain("html:root [data-ipw-brand-slot]");
    expect(source).toContain("width: 18px !important; height: 18px !important");
    expect(source).toContain("object-fit: contain !important");
    expect(source).toContain('import.meta.glob("./design-systems/design-systems/*/design-tokens.json"');
    expect(source).not.toContain('as: "raw"');
    expect(source.match(/query: "\?raw"/g)).toHaveLength(6);
    expect(source).toContain("buildDesignSystemPresetValues");
    expect(source).toContain('"--ipw-type-scale": themeTypeScale(tokens)');
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

  test("shares token file parsing and updates across Design and Video Studio", () => {
    const source = ":root {\n  --ipw-od-bg: #111111;\n}\n";
    expect(linkedDesignTokenPath('<link rel="stylesheet" href="design-tokens.css">')).toBe("design-tokens.css");
    expect(parseDesignTokenValues(source)["--ipw-od-bg"]).toBe("#111111");
    expect(replaceDesignTokenValue(source, "--ipw-od-bg", "#ffffff")).toContain("--ipw-od-bg: #ffffff;");
    expect(replaceDesignTokenValue(source, "--ipw-od-accent", "#2563eb")).toContain("--ipw-od-accent: #2563eb;");
  });

  test("replaces only the managed theme block and preserves template CSS", () => {
    const existing = `/* ipw-theme:start */\n:root { --ipw-color-bg: red; }\n/* ipw-theme:end */\n.logo { width: 18px; }`;
    const next = mergeTemplateTokenCss(existing, `/* ipw-theme:start */\n:root { --ipw-color-bg: blue; }\n/* ipw-theme:end */`);
    expect(next).toContain("--ipw-color-bg: blue");
    expect(next).not.toContain("--ipw-color-bg: red");
    expect(next).toContain(".logo { width: 18px; }");
  });

  test("scales typography from a stable original size instead of compounding from em", async () => {
    const source = await Bun.file(registryPath).text();

    expect(source).toContain("--ipw-original-font-size");
    expect(source).toContain("--ipw-original-font-size: var(--ipw-od-text-4xl, 2.5rem)");
    expect(source).toContain("--ipw-original-font-size: var(--ipw-od-text-base, 1rem)");
    expect(source).toContain(':where([data-ipw-theme-role="accent"], .eyebrow, .kicker, [class~="accent"]) { --ipw-original-font-size: var(--ipw-od-text-xs, .75rem);');
    expect(source).toContain(':where([data-ipw-theme-role="muted"], .lede, .lead, .subtitle, .description) { --ipw-original-font-size: var(--ipw-od-text-lg, 1.125rem);');
    expect(source).toContain("line-height: var(--leading-tight, 1.08) !important");
    expect(source).toContain("letter-spacing: var(--tracking-display, 0) !important");
    expect(source).toContain("font-size: calc(var(--ipw-original-font-size) * var(--ipw-type-scale)) !important");
    expect(source).not.toContain("font-size: calc(1em * var(--ipw-type-scale)) !important");
  });

  test("migrates legacy variables without dropping structural rules", () => {
    const existing = `:root { --ipw-color-bg: red; --template-ratio: 1.5; }\n.ipw-brand-slot img { width: 18px; }`;
    const next = mergeTemplateTokenCss(existing, `/* ipw-theme:start */\n:root { --ipw-color-bg: blue; }\n/* ipw-theme:end */`);
    expect(next).toContain("--ipw-color-bg: blue");
    expect(next).not.toContain("--ipw-color-bg: red");
    expect(next).toContain("--template-ratio: 1.5");
    expect(next).toContain(".ipw-brand-slot img { width: 18px; }");
  });

  test("renders only source tokens from the persisted current theme", async () => {
    const [drawer, panel] = await Promise.all([
      Bun.file(drawerPath).text(),
      Bun.file(panelPath).text(),
    ]);

    expect(drawer).toContain("currentThemeId");
    expect(drawer).toContain("currentTheme");
    expect(drawer).toContain('t("design_system.current_theme"');
    expect(drawer).toContain('t("design_system.no_theme")');
    expect(drawer).toContain('t("design_system.variables_disabled_hint")');
    expect(drawer).toContain("function ThemePreview");
    expect(drawer).toContain("preview_loading");
    expect(drawer).toContain("preview_failed");
    expect(drawer).toContain("buildDesignSystemTokenControls(selectedTheme)");
    expect(drawer).toContain("selectedThemeControls.map");
    expect(drawer).toContain('t("design_system.variables_footer")');
    expect(drawer).not.toContain(">Design system<");
    expect(drawer).not.toContain("Search themes...");
    expect(drawer).not.toContain("No themes found.");
    expect(drawer).not.toContain("Reset all</Button>");
    expect(drawer).not.toContain(">当前主题<");
    expect(drawer).not.toContain(">应用主题<");
    expect(drawer).toContain('PanelSection title={t("design_system.embedded.background")}');
    expect(drawer).toContain('mode === itemMode ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"');
    expect(drawer).toContain('<Minus aria-hidden="true" className="size-4" />');
    expect(drawer).not.toContain("backgroundSolidDefaultIcon");
    expect(drawer).not.toContain("backgroundSolidActiveIcon");
    expect(drawer).toContain("DesignImageFitSelect");
    expect(drawer).toContain("buildDesignSystemPresetValues(theme)");
    expect(drawer).not.toContain("Image overlay");
    expect(drawer).not.toContain("Glass effect");
    expect(drawer).toContain("absolute inset-y-0 right-0");
    expect(drawer).toContain("translate-x-full");
    expect(drawer).not.toContain("transition-[width,border-color]");
    expect(drawer).toContain("DRAWER_WIDTH_STORAGE_KEY");
    expect(drawer).toContain('role="separator"');
    expect(drawer).toContain("onPointerDown={startResize}");
    expect(drawer).toContain("onKeyDown={handleResizeKeyDown}");
    expect(drawer).toContain("left-0 z-10 w-1");
    expect(drawer).not.toContain("-translate-x-1/2 cursor-col-resize");
    expect(drawer).not.toContain('w-[360px]');
    expect(panel).toContain("readAppliedDesignSystemId");
    expect(panel).toContain("currentThemeId={appliedDesignSystemId}");
    expect(panel).not.toContain('type: "set-token",\n      name,\n      value');
  });
});
