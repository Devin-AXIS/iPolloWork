import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sidebarPath = fileURLToPath(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
);

describe("managed brand header", () => {
  test("shows a round 24-pixel organization logo next to the application name", () => {
    const source = readFileSync(sidebarPath, "utf8");

    expect(source).toContain("brandLogoUrl ?? shellConfig.brandLogoDataUrl");
    expect(source).toContain('className="size-6 shrink-0 rounded-full object-cover"');
    expect(source).toContain('data-testid="brand-logo-placeholder"');
    expect(source).toContain('data-testid="brand-app-name"');
    expect(source).toMatch(/className="flex h-14 shrink-0 items-center/);
  });
});
