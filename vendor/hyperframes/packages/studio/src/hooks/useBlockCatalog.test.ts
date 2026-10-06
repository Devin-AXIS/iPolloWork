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
  it("keeps the retained component categories in one ordered contract", () => {
    expect(COMPONENT_CATALOG_SECTIONS).toEqual(["maps", "media", "business"]);
  });

  it("only admits registry items with an explicit visual component category", () => {
    expect(resolveCatalogSection(item("route-map", "maps"))).toBe("maps");
    expect(resolveCatalogSection(item("ordinary-block"))).toBeNull();
  });

  it("maps the retained legacy interface category and rejects deleted categories", () => {
    expect(resolveCatalogSection({ visualComponent: { category: "interface" } })).toBe("media");
    for (const category of ["intro", "outro", "flow", "compare", "structured", "commerce"]) {
      expect(resolveCatalogSection({ visualComponent: { category } })).toBeNull();
    }
  });
});
