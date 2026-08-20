import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sidebarPath = fileURLToPath(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
);

describe("managed brand header", () => {
  test("shows a round 24-pixel organization logo next to the application name", () => {
    const source = readFileSync(sidebarPath, "utf8");

    expect(source).toContain("activeEnterprise.logoUrl ?? DEFAULT_BRAND_LOGO_URL");
    expect(source).toContain("brandLogoUrl ?? shellConfig.brandLogoDataUrl ?? DEFAULT_BRAND_LOGO_URL");
    expect(source).toContain("activeEnterprise?.name ?? brandAppName");
    expect(source).toContain('className="size-6 shrink-0 rounded-full object-cover"');
    expect(source).toContain('data-testid="brand-logo"');
    expect(source).not.toContain('data-testid="brand-logo-placeholder"');
    expect(source).toContain('data-testid="brand-app-name"');
    expect(source).toContain("title={effectiveBrandAppName}");
    expect(source).toMatch(/className="flex h-14 shrink-0 items-center/);
  });

  test("uses the bundled brand avatar and translucent macOS sidebar material by default", () => {
    const source = readFileSync(sidebarPath, "utf8");
    const brandThemeSource = readFileSync(
      new URL("../src/react-app/domains/cloud/brand-theme.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("DEFAULT_BRAND_LOGO_URL");
    expect(source).toContain("mac:bg-sidebar/15");
    expect(source).toContain("mac:backdrop-blur-2xl");
    expect(source).toContain('SidebarHeader className="gap-3 px-2 pb-3 pt-1');
    expect(brandThemeSource).toContain('publicAssetUrl("default-brand-avatar.jpg")');
    expect(existsSync(new URL("../public/default-brand-avatar.jpg", import.meta.url))).toBe(true);
  });

  test("keeps primary sidebar actions regular in English and medium in Chinese", () => {
    const source = readFileSync(sidebarPath, "utf8");
    const providerSource = readFileSync(
      new URL("../src/react-app/domains/session/sidebar/app-sidebar-provider.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('language === "zh" && "font-medium"');
    expect(source).toContain('ctx.language === "zh" ? "font-medium" : "font-normal"');
    expect(providerSource).toContain("language: Language");
    expect(source).toContain("text-sm font-normal");
    expect(source.match(/className=\{primarySidebarActionClass\}/g)).toHaveLength(5);
  });
});
