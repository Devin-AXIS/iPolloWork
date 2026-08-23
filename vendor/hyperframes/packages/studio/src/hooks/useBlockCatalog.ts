import { useEffect, useMemo, useState } from "react";
import {
  VISUAL_COMPONENT_CATEGORIES,
  type RegistryItem,
  type RegistryItemKind,
  type RegistryVisualComponentCategory,
  resolveRegistryItemKind,
} from "@hyperframes/core/registry";
import { type BlockCategory, resolveBlockCategory } from "../utils/blockCategories";

export type CatalogItem = RegistryItem & {
  category: BlockCategory;
  kind: RegistryItemKind;
};

export type CatalogSectionId = RegistryVisualComponentCategory;

export interface CatalogSection {
  id: CatalogSectionId;
  items: CatalogItem[];
}

export const COMPONENT_CATALOG_SECTIONS = VISUAL_COMPONENT_CATEGORIES;

const SECTION_SEARCH_TERMS: Record<CatalogSectionId, string> = {
  intro: "intro opening 开场 片头",
  product: "product demo showcase 产品 展示",
  data: "data chart metrics 数据 图表 指标",
  diagrams: "diagram architecture pyramid framework 图解 架构 金字塔",
  flow: "flow process timeline 流程 路径 时间线",
  maps: "map route location geography 地图 路线 地理",
  compare: "compare before after versus 对比 前后",
  knowledge: "knowledge education explain 知识 教育 讲解",
  people: "people profile quote team 人物 团队 观点",
  proof: "proof evidence source testimonial 佐证 证据 来源",
  outro: "outro ending cta 结尾 片尾 行动",
};

function isVisualComponentCategory(value: unknown): value is RegistryVisualComponentCategory {
  return VISUAL_COMPONENT_CATEGORIES.some((category) => category === value);
}

let catalogCache: CatalogItem[] | null = null;
let catalogRequest: Promise<CatalogItem[]> | null = null;

function normalizeCatalogItems(data: RegistryItem[]): CatalogItem[] {
  return data
    .map((item) => ({
      ...item,
      category: resolveBlockCategory(item.tags),
      kind: resolveRegistryItemKind(item),
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

export function resolveCatalogSection(item: CatalogItem): CatalogSectionId | null {
  const category = item.visualComponent?.category;
  return isVisualComponentCategory(category) ? category : null;
}

export function useBlockCatalog() {
  const [blocks, setBlocks] = useState<CatalogItem[]>(() => catalogCache ?? []);
  const [loading, setLoading] = useState(() => catalogCache === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    void preloadBlockCatalog()
      .then((items) => {
        if (active) setBlocks(items);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load catalog");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredBlocks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return blocks.filter((block) => {
      const section = resolveCatalogSection(block);
      if (!section) return false;
      if (!query) return true;
      return (
        block.title.toLowerCase().includes(query) ||
        block.description.toLowerCase().includes(query) ||
        block.category.toLowerCase().includes(query) ||
        SECTION_SEARCH_TERMS[section].includes(query) ||
        block.tags?.some((tag) => tag.toLowerCase().includes(query)) ||
        block.engine?.plugins?.some((plugin) => plugin.toLowerCase().includes(query))
      );
    });
  }, [blocks, search]);

  const sections = useMemo<CatalogSection[]>(
    () =>
      COMPONENT_CATALOG_SECTIONS.map((id) => ({
        id,
        items: filteredBlocks.filter((block) => resolveCatalogSection(block) === id),
      })),
    [filteredBlocks],
  );

  return {
    loading,
    error,
    search,
    setSearch,
    sections,
  };
}
