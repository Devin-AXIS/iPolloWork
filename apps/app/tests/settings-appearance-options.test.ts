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

  test("hides the dark theme choice without removing theme compatibility", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/settings/appearance/theme-section.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain('value="dark"');
    expect(source).not.toContain('t("settings.theme_dark")');
    expect(source).toContain('value="system"');
    expect(source).toContain('value="light"');
    expect(en["settings.appearance_hint"]).not.toContain("dark");
    expect(zh["settings.appearance_hint"]).not.toContain("深色");
  });
});
