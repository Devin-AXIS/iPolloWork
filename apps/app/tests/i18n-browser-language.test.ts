import { describe, expect, test } from "bun:test";

import { languageFromLocale, preferredLanguage, t, translationKey } from "../src/i18n";

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


test("declared translation families retain locale, interpolation and unknown-value fallback", () => {
  expect(t(translationKey("work.priority.", "high"), "en")).toBe(t("work.priority.high", "en"));
  expect(t(translationKey("work.priority.", "high"), "zh")).toBe(t("work.priority.high", "zh"));
  expect(t(translationKey("templates.brief.reference_unsupported_", "other"), { lng: "en", count: 2 }))
    .toBe(t("templates.brief.reference_unsupported_other", { lng: "en", count: 2 }));
  expect(t(translationKey("work.priority.", "unknown"), "en")).toBe("work.priority.unknown");
});
