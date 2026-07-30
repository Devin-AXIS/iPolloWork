import { describe, expect, test } from "bun:test";

import { languageFromLocale, preferredLanguage } from "../src/i18n";

describe("browser language detection", () => {
  test("matches supported languages with country and script tags", () => {
    expect(languageFromLocale("en-SG")).toBe("en");
    expect(languageFromLocale("ja-JP")).toBe("ja");
    expect(languageFromLocale("zh-CN")).toBe("zh");
    expect(languageFromLocale("zh-Hans")).toBe("zh");
    expect(languageFromLocale("pt-BR")).toBe("pt-BR");
  });

  test("does not map unsupported regional variants to a different locale", () => {
    expect(languageFromLocale("zh-TW")).toBeNull();
    expect(languageFromLocale("pt-PT")).toBeNull();
  });

  test("uses the first supported browser preference and falls back to English", () => {
    expect(preferredLanguage(["de-DE", "fr-CA", "en-US"])).toBe("fr");
    expect(preferredLanguage(["de-DE", "ko-KR"])).toBe("en");
  });
});
