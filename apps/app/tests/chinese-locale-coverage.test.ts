import { describe, expect, test } from "bun:test";

import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";

describe("Simplified Chinese locale coverage", () => {
  test("covers every English baseline key", () => {
    expect(Object.keys(en).filter((key) => !(key in zh))).toEqual([]);
  });
});
