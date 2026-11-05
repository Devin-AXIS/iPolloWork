import { describe, expect, test } from "bun:test";

import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";

describe("Simplified Chinese locale coverage", () => {
  test("covers every English baseline key", () => {
    expect(Object.keys(en).filter((key) => !(key in zh))).toEqual([]);
  });

  test("uses 模板 consistently", () => {
    expect(Object.values(zh).filter((value) => value.includes("\u6a21\u7248"))).toEqual([]);
  });
});
