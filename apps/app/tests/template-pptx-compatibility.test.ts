import { describe, expect, test } from "bun:test";

import {
  isPptxCompatibleTemplate,
  sortTemplatesForCatalog,
} from "@ipollowork/types/templates";

describe("PPTX-compatible templates", () => {
  test("recognizes the native-editable slide capability", () => {
    expect(isPptxCompatibleTemplate({
      category: "slides",
      pptxCompatibility: "native-editable",
    })).toBe(true);
    expect(isPptxCompatibleTemplate({ category: "slides" })).toBe(false);
    expect(isPptxCompatibleTemplate({
      category: "site",
      pptxCompatibility: "native-editable",
    })).toBe(false);
  });

  test("places native-editable slides before visual-first slides", () => {
    const templates = sortTemplatesForCatalog([
      { category: "slides", title: "Visual Deck", pptxCompatibility: undefined },
      { category: "site", title: "Website", pptxCompatibility: undefined },
      { category: "slides", title: "Native Deck", pptxCompatibility: "native-editable" },
    ]);

    expect(templates.map((template) => template.title)).toEqual([
      "Native Deck",
      "Website",
      "Visual Deck",
    ]);
  });
});
