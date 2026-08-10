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

export type AnimationLibrarySection =
  | "opening-animation"
  | "ending-animation"
  | "transition-animation"
  | "caption-animation";

export type CatalogPage = "animation" | "scene";

export interface CatalogSection {
  id: AnimationLibrarySection;
  items: CatalogItem[];
}

export const CATALOG_PAGE_SECTIONS: Record<CatalogPage, readonly AnimationLibrarySection[]> = {
  animation: ["opening-animation", "ending-animation", "transition-animation", "caption-animation"],
  scene: ["opening-animation", "ending-animation", "transition-animation"],
};

const SECTION_SEARCH_TERMS: Record<AnimationLibrarySection, string> = {
  "opening-animation": "opening intro title logo 开场 片头 标题",
  "ending-animation": "ending outro cta logo 结尾 片尾 收束",
  "transition-animation": "transition scene wipe push 转场 场景 切换",
  "caption-animation": "caption subtitle text 字幕 文字 逐词",
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
  return (
    value === "opening-animation" ||
    value === "ending-animation" ||
    value === "transition-animation" ||
    value === "caption-animation"
  );
}

export function useBlockCatalog(page: CatalogPage) {
  const [blocks, setBlocks] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/registry/blocks", { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to load catalog");
        const data: RegistryItem[] = await res.json();
        const items = data
          .filter(
            (
              block,
            ): block is RegistryItem & {
              librarySection: AnimationLibrarySection;
            } => isCatalogLibrarySection(block.librarySection),
          )
          .map((block) => {
            const category = resolveBlockCategory(block.tags);
            return {
              ...block,
              category,
              kind: resolveRegistryItemKind(block),
              librarySection: block.librarySection,
            };
          })
          .sort((a, b) => a.title.localeCompare(b.title));
        if (controller.signal.aborted) return;
        setBlocks(items);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
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
