import { describe, expect, test } from "bun:test";

const panelUrl = new URL(
  "../src/react-app/domains/session/design/design-panel.tsx",
  import.meta.url,
);
const drawerUrl = new URL(
  "../src/react-app/domains/session/design/design-system-drawer.tsx",
  import.meta.url,
);

describe("Design System toolbar", () => {
  test("keeps Design System inside the shared properties inspector", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('aria-label="Toggle design properties"');
    expect(source).toContain('activeTab={propertiesTab}');
    expect(source).toContain('open={propertiesTab === "design-system"}');
    expect(source).not.toContain('aria-label="Toggle design system"');
    expect(source).not.toContain('data-testid="design-system-button"');
    expect(source).not.toContain("designSystemOpen");
  });

  test("resets only the visible theme colors from the inline reset control", async () => {
    const source = await Bun.file(drawerUrl).text();

    expect(source).toContain("const THEME_COLOR_TOKEN_NAMES = [");
    expect(source).toContain("const resetThemeColors = React.useCallback(() => {");
    expect(source).toContain("THEME_COLOR_TOKEN_NAMES.map((name) => [name, presetValues[name] ?? DEFAULTS[name]])");
    expect(source).toContain("const canResetThemeColors = colorValues.some");
    expect(source).toContain("event.stopPropagation(); onResetColors();");
    expect(source).toContain("disabled={!canResetThemeColors}");
    expect(source).toContain('className="absolute inset-0 size-full cursor-pointer opacity-0"');
    expect(source).toContain('className="relative z-10 grid size-[25px]');
    expect(source).toContain('title={t("design_system.embedded.reset_theme_colors")}');
    expect(source).toContain('onClick={onReset}><RotateCcw /> {t("design_system.embedded.reset")}');
  });
});
