import { describe, expect, it } from "vitest";

import type { CatalogItem } from "./useBlockCatalog";
import {
  isCatalogLibrarySection,
  isGsapCatalogItem,
  resolveGsapCatalogCoverage,
} from "./useBlockCatalog";

function item(name: string, plugins: string[]): CatalogItem {
  return {
    name,
    version: "1.0.0",
    type: "hyperframes:block",
    kind: "effect",
    librarySection: "opening-effect",
    category: "effects",
    title: name,
    description: name,
    dimensions: { width: 1920, height: 1080 },
    duration: 6,
    files: [],
    engine: {
      name: "gsap",
      version: "3.15.0",
      plugins,
    },
  };
}

describe("resolveGsapCatalogCoverage", () => {
  it("counts official plugin and ease coverage independently", () => {
    const coverage = resolveGsapCatalogCoverage([
      item("scroll", ["ScrollTrigger"]),
      item("ease", ["CustomEase"]),
      item("unrelated", ["MadeUpPlugin"]),
    ]);

    expect(coverage).toEqual({
      plugins: { covered: 1, total: 19 },
      eases: { covered: 1, total: 6 },
    });
  });
});

describe("isGsapCatalogItem", () => {
  it("keeps non-GSAP components out of the GSAP libraries", () => {
    expect(isGsapCatalogItem(item("gsap", ["ScrollTrigger"]))).toBe(true);
    expect(
      isGsapCatalogItem({
        ...item("shader", []),
        engine: { name: "three", version: "0.180.0" },
      }),
    ).toBe(false);
  });
});

describe("isCatalogLibrarySection", () => {
  it("accepts only explicit library section values", () => {
    expect(isCatalogLibrarySection("opening-effect")).toBe(true);
    expect(isCatalogLibrarySection("transition-effect")).toBe(true);
    expect(isCatalogLibrarySection("opening-animation")).toBe(false);
    expect(isCatalogLibrarySection("caption-animation")).toBe(false);
    expect(isCatalogLibrarySection(undefined)).toBe(false);
    expect(isCatalogLibrarySection("background-scene")).toBe(false);
    expect(isCatalogLibrarySection("effects")).toBe(false);
  });
});
