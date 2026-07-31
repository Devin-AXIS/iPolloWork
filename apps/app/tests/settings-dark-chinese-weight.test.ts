import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/app/index.css"), "utf8");
const panel = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/settings/shell/panel.tsx"),
  "utf8",
);

describe("settings dark Chinese typography", () => {
  test("raises only the default Chinese settings weight in dark mode", () => {
    expect(panel).toContain("data-settings-content");
    expect(css).toContain('html[lang="zh"][data-theme="dark"] [data-settings-content]');
    expect(css).toContain("font-weight: 450;");
  });

  test("keeps the adjustment scoped away from English and light mode", () => {
    expect(css).not.toContain('html[lang="en"][data-theme="dark"] [data-settings-content]');
    expect(css).not.toContain('html[lang="zh"][data-theme="light"] [data-settings-content]');
  });
});
