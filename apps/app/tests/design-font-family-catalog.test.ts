import { describe, expect, test } from "bun:test";

import {
  filterFontFamilyOptions,
  fontFamilyOptions,
} from "../src/react-app/domains/session/design/font-family-catalog";

describe("fontFamilyOptions", () => {
  test("pins the current font then alphabetizes unique catalog entries", () => {
    expect(
      fontFamilyOptions("Playfair Display", ["Arial", "playfair display", "Noto Sans", "Arial"]),
    ).toEqual(["Playfair Display", "Arial", "Noto Sans"]);
  });

  test("filters names case-insensitively", () => {
    expect(
      filterFontFamilyOptions(["Playfair Display", "Arial", "Noto Sans"], "sans"),
    ).toEqual(["Noto Sans"]);
  });
});
