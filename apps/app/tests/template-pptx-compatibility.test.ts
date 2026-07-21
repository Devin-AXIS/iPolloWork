import { describe, expect, test } from "bun:test";

import {
  isPptxCompatibleTemplate,
  sortTemplatesForCatalog,
  templateManifestV1Schema,
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

  test("rejects PPTX compatibility metadata on non-slide templates", () => {
    const result = templateManifestV1Schema.safeParse({
      schemaVersion: 1,
      id: "local.invalid-pptx-site",
      version: "1.0.0",
      kind: "design",
      category: "site",
      subcategory: "landing",
      style: "minimal",
      tags: [],
      pptxCompatibility: "native-editable",
      surface: "design",
      title: "Invalid PPTX Site",
      description: "A website cannot claim presentation compatibility.",
      cover: "cover.svg",
      entry: "entry.html",
      source: { name: "Local author", license: "MIT" },
      designSystem: { tokenVersion: 1, editableGroups: ["theme"], variables: [] },
      applyChecklist: ["Update the content"],
      minimumAppVersion: "0.17.0",
    });
    expect(result.success).toBe(false);
  });
});
