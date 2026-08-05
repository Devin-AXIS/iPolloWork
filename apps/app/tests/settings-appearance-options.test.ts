import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { LANGUAGES, LANGUAGE_OPTIONS } from "../src/i18n";
import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";

describe("appearance settings options", () => {
  test("shows only English and Simplified Chinese in language selectors", () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(["en", "zh"]);
    expect(LANGUAGES).toContain("ja");
  });

  test("shows system, light, and dark theme choices", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/settings/appearance/theme-section.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('value="system"');
    expect(source).toContain('value="light"');
    expect(source).toContain('value="dark"');
    expect(source).toContain('t("settings.theme_dark")');
    expect(source).toContain('<ThemePreview value="dark" className="bg-black" />');
    expect(source).toContain('<div className="w-1/2 bg-white" />');
    expect(source).toContain('<div className="w-1/2 bg-black" />');
    expect(en["settings.appearance_hint"]).toContain("dark");
    expect(zh["settings.appearance_hint"]).toContain("深色");
  });
});
