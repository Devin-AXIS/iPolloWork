import { useState, useEffect, useMemo } from "react";
import {
  GSAP_OFFICIAL_CAPABILITIES,
  type RegistryItem,
  type RegistryItemKind,
  resolveRegistryItemKind,
} from "@hyperframes/core/registry";
import { type BlockCategory, resolveBlockCategory } from "../utils/blockCategories";

export type CatalogItem = RegistryItem & {
  category: BlockCategory;
  kind: RegistryItemKind;
  librarySection: AnimationLibrarySection;
};

export type AnimationLibrarySection = "opening-effect" | "ending-effect" | "transition-effect";

export type CatalogPage = "effects";

export interface CatalogSection {
  id: AnimationLibrarySection;
  items: CatalogItem[];
}

export const CATALOG_PAGE_SECTIONS: Record<CatalogPage, readonly AnimationLibrarySection[]> = {
  effects: ["opening-effect", "ending-effect", "transition-effect"],
};

const SECTION_SEARCH_TERMS: Record<AnimationLibrarySection, string> = {
  "opening-effect": "opening intro title logo 开头 片头 开场",
  "ending-effect": "ending outro cta follow social 结尾 片尾 关注 三连",
  "transition-effect": "transition scene wipe push 转场 场景 切换",
};

export function resolveGsapCatalogCoverage(items: CatalogItem[]) {
  const declaredCapabilities = new Set(items.flatMap((item) => item.engine?.plugins ?? []));
  const plugins = GSAP_OFFICIAL_CAPABILITIES.filter((capability) => capability.kind === "plugin");
  const eases = GSAP_OFFICIAL_CAPABILITIES.filter((capability) => capability.kind === "ease");
  return {
    plugins: {
      covered: plugins.filter((capability) => declaredCapabilities.has(capability.runtimeName))
        .length,
      total: plugins.length,
    },
    eases: {
      covered: eases.filter((capability) => declaredCapabilities.has(capability.runtimeName))
        .length,
      total: eases.length,
    },
  };
}

export function isGsapCatalogItem(item: CatalogItem): boolean {
  return item.engine?.name.trim().toLowerCase() === "gsap";
}

export function isCatalogLibrarySection(value: unknown): value is AnimationLibrarySection {
  return value === "opening-effect" || value === "ending-effect" || value === "transition-effect";
}

let catalogCache: CatalogItem[] | null = null;
let catalogRequest: Promise<CatalogItem[]> | null = null;

function normalizeCatalogItems(data: RegistryItem[]): CatalogItem[] {
  return data
    .filter(
      (
        block,
      ): block is RegistryItem & {
        librarySection: AnimationLibrarySection;
      } => isCatalogLibrarySection(block.librarySection),
    )
    .map((block) => ({
      ...block,
      category: resolveBlockCategory(block.tags),
      kind: resolveRegistryItemKind(block),
      librarySection: block.librarySection,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function preloadBlockCatalog(): Promise<CatalogItem[]> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (catalogRequest) return catalogRequest;

  catalogRequest = fetch("/api/registry/blocks")
    .then(async (response) => {
      if (!response.ok) throw new Error("Failed to load catalog");
      const data: RegistryItem[] = await response.json();
      catalogCache = normalizeCatalogItems(data);
      return catalogCache;
    })
    .catch((error: unknown) => {
      catalogRequest = null;
      throw error;
    });
  return catalogRequest;
}

export function useBlockCatalog(page: CatalogPage) {
  const [blocks, setBlocks] = useState<CatalogItem[]>(() => catalogCache ?? []);
  const [loading, setLoading] = useState(() => catalogCache === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const items = await preloadBlockCatalog();
        if (!active) return;
        setBlocks(items);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const pageSections = CATALOG_PAGE_SECTIONS[page];
  const filteredBlocks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return blocks.filter((block) => {
      if (!isGsapCatalogItem(block) || !pageSections.includes(block.librarySection)) return false;
      if (!query) return true;
      return (
        block.title.toLowerCase().includes(query) ||
        block.description.toLowerCase().includes(query) ||
        block.category.toLowerCase().includes(query) ||
        SECTION_SEARCH_TERMS[block.librarySection].includes(query) ||
        block.tags?.some((tag) => tag.toLowerCase().includes(query)) ||
        block.engine?.plugins?.some((plugin) => plugin.toLowerCase().includes(query))
      );
    });
  }, [blocks, pageSections, search]);

  const sections = useMemo(
    () =>
      pageSections.map((id) => ({
        id,
        items: filteredBlocks.filter((block) => block.librarySection === id),
      })),
    [filteredBlocks, pageSections],
  );

  return {
    loading,
    error,
    search,
    setSearch,
    sections,
  };
}
