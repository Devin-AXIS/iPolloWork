import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readAppSource = (path: string) => readFileSync(
  new URL(`../src/react-app/domains/session/${path}`, import.meta.url),
  "utf8",
);

describe("dark theme regressions", () => {
  test("keeps sidebar actions and folder rows on semantic theme colors", () => {
    const source = readAppSource("sidebar/app-sidebar.tsx");

    expect(source).toContain("text-sidebar-foreground");
    expect(source).toContain("hover:bg-sidebar-accent");
    expect(source).not.toContain("dark:text-black");
    expect(source).not.toContain('leading-4 text-black outline-hidden');
  });

  test("keeps design inspector chrome on semantic theme surfaces", () => {
    const source = readAppSource("design/design-properties-inspector.tsx");

    expect(source).toContain('border-l border-border bg-background text-foreground');
    expect(source).toContain('border-border bg-popover');
    expect(source).not.toContain('aria-label="Design inspector">\n      <header className="sticky left-0 top-0 z-20 flex h-[58px] w-full shrink-0 items-center border-b border-[#ebebeb] bg-white');
  });
});
