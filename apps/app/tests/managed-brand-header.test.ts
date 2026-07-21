import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sidebarPath = fileURLToPath(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
);

describe("managed brand header", () => {
  test("uses a managed logo, managed name, then the default wordmark", () => {
    const source = readFileSync(sidebarPath, "utf8");

    expect(source).toMatch(/brandLogoUrl \? \([\s\S]*?data-testid="brand-logo"[\s\S]*?\) : hasManagedBrand \? \([\s\S]*?data-testid="brand-app-name"/);
    expect(source).toContain('src={publicAssetUrl("sidebar-icon/ipollo-work.svg")}');
    expect(source).toContain('className="h-3.5 w-auto max-w-[140px] object-contain object-left"');
  });
});
