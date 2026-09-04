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
  it("keeps the thirteen clear component categories in one ordered contract", () => {
    expect(COMPONENT_CATALOG_SECTIONS).toEqual([
      "scene",
      "product",
      "data",
      "diagrams",
      "maps",
      "proof",
      "knowledge",
      "people",
      "typography",
      "media",
      "social",
      "developer",
      "brand",
    ]);
  });

  it("only admits registry items with an explicit visual component category", () => {
    expect(resolveCatalogSection(item("route-map", "maps"))).toBe("maps");
    expect(resolveCatalogSection(item("ordinary-block"))).toBeNull();
  });

  it("maps legacy version-one categories into the canonical taxonomy", () => {
    expect(resolveCatalogSection({ visualComponent: { category: "intro" } })).toBe("scene");
    expect(resolveCatalogSection({ visualComponent: { category: "outro" } })).toBe("scene");
    expect(resolveCatalogSection({ visualComponent: { category: "flow" } })).toBe("diagrams");
    expect(resolveCatalogSection({ visualComponent: { category: "compare" } })).toBe("proof");
    expect(resolveCatalogSection({ visualComponent: { category: "interface" } })).toBe("media");
    expect(resolveCatalogSection({ visualComponent: { category: "structured" } })).toBe("data");
    expect(resolveCatalogSection({ visualComponent: { category: "commerce" } })).toBe("brand");
  });
});
