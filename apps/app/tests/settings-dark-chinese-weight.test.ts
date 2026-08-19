import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/app/index.css"), "utf8");
const panel = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/settings/shell/panel.tsx"),
  "utf8",
);
const button = readFileSync(join(import.meta.dir, "../src/components/ui/button.tsx"), "utf8");
const input = readFileSync(join(import.meta.dir, "../src/components/ui/input.tsx"), "utf8");
const dialog = readFileSync(join(import.meta.dir, "../src/components/ui/dialog.tsx"), "utf8");

describe("desktop typography contract", () => {
  test("uses one system font contract for Chinese and English UI", () => {
    expect(panel).toContain("data-settings-content");
    expect(css).toContain("--ipollowork-font-sans:");
    expect(css).toContain('"PingFang SC"');
    expect(css).toContain('"Microsoft YaHei"');
    expect(css).toContain('"Noto Sans SC"');
    expect(css).toContain("--ipollowork-font-mono:");
    expect(css).toContain("--font-mono: var(--ipollowork-font-mono);");
  });

  test("does not change font weight by language or theme", () => {
    expect(css).not.toContain('[lang="zh"]');
    expect(css).not.toContain("font-weight: 450;");
  });

  test("uses platform font smoothing for light text in dark mode", () => {
    expect(css).toMatch(
      /\.dark body,\s*\[data-theme="dark"\] body\s*\{[^}]*-webkit-font-smoothing: auto;[^}]*-moz-osx-font-smoothing: auto;[^}]*\}/,
    );
  });

  test("keeps muted text readable in dark mode", () => {
    expect(css).toMatch(
      /\.dark,\s*\[data-theme="dark"\]\s*\{[^}]*--muted-foreground: var\(--slate-11\);/,
    );
  });

  test("maps scalable semantic text roles into shared controls", () => {
    expect(css).toContain("--text-ui-caption: 0.6875rem;");
    expect(css).toContain("--text-ui-control: 0.8125rem;");
    expect(css).toContain("--text-ui-body: 0.875rem;");
    expect(css).toContain("--text-ui-title-sm: 1rem;");
    expect(button).toContain("text-ui-control font-medium");
    expect(input).toContain("text-ui-control");
    expect(dialog).toContain("text-ui-title-sm font-semibold");
  });
});
