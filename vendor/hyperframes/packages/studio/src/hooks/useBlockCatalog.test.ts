import { describe, expect, it } from "vitest";

import type { CatalogItem } from "./useBlockCatalog";
import { COMPONENT_CATALOG_SECTIONS, resolveCatalogSection } from "./useBlockCatalog";

function item(name: string, category?: "maps"): CatalogItem {
  return {
    name,
    version: "1.0.0",
    type: "hyperframes:block",
    kind: "scene",
    category: "data",
    title: name,
    description: name,
    dimensions: { width: 1920, height: 1080 },
    duration: 6,
    files: [],
    visualComponent: category
      ? {
          version: 1,
          category,
          surfaces: ["video"],
          themeMode: "inherit",
        }
      : undefined,
  };
}

describe("component catalog contract", () => {
  it("keeps the eleven short component categories in one ordered contract", () => {
    expect(COMPONENT_CATALOG_SECTIONS).toEqual([
      "intro",
      "product",
      "data",
      "diagrams",
      "flow",
      "maps",
      "compare",
      "knowledge",
      "people",
      "proof",
      "outro",
    ]);
  });

  it("only admits registry items with an explicit visual component category", () => {
    expect(resolveCatalogSection(item("route-map", "maps"))).toBe("maps");
    expect(resolveCatalogSection(item("ordinary-block"))).toBeNull();
  });
});
