import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sidebarPath = fileURLToPath(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
);

describe("managed brand header", () => {
  test("shows a round 24-pixel organization logo next to the application name", () => {
    const source = readFileSync(sidebarPath, "utf8");

    expect(source).toContain("brandLogoUrl ?? shellConfig.brandLogoDataUrl ?? DEFAULT_BRAND_LOGO_URL");
    expect(source).toContain('className="size-6 shrink-0 rounded-full object-cover"');
    expect(source).toContain('data-testid="brand-logo"');
    expect(source).not.toContain('data-testid="brand-logo-placeholder"');
    expect(source).toContain('data-testid="brand-app-name"');
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
    expect(brandThemeSource).toContain('publicAssetUrl("default-brand-avatar.jpg")');
    expect(existsSync(new URL("../public/default-brand-avatar.jpg", import.meta.url))).toBe(true);
  });
});
