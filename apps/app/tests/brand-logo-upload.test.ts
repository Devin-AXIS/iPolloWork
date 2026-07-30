import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const shellConfigSource = readFileSync(
  new URL("../src/react-app/shell/shell-config.tsx", import.meta.url),
  "utf8",
);
const shellViewSource = readFileSync(
  new URL("../src/react-app/domains/settings/pages/shell-view.tsx", import.meta.url),
  "utf8",
);

describe("organization logo upload", () => {
  test("persists only validated raster image data URLs", () => {
    expect(shellConfigSource).toContain("brandLogoDataUrl: string | null");
    expect(shellConfigSource).toContain("brandLogoDataUrl: null");
    expect(shellConfigSource).toContain("/^data:image\\/(?:png|jpeg|webp);base64,/");
  });

  test("supports preview, upload, replacement, and removal", () => {
    expect(shellViewSource).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(shellViewSource).toContain("BRAND_LOGO_MAX_BYTES = 1024 * 1024");
    expect(shellViewSource).toContain('data-testid="brand-logo-upload-preview"');
    expect(shellViewSource).toContain("update({ brandLogoDataUrl })");
    expect(shellViewSource).toContain("update({ brandLogoDataUrl: null })");
  });

  test("gives an organization-managed logo priority over the local upload", () => {
    expect(shellViewSource).toContain("managedBrandLogoUrl ?? config.brandLogoDataUrl ?? DEFAULT_BRAND_LOGO_URL");
    expect(shellViewSource).toContain("disabled={Boolean(managedBrandLogoUrl)}");
  });
});
