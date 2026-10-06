import { useCallback, useEffect, useMemo, useState } from "react";
import {
  VISUAL_COMPONENT_CATEGORIES,
  type RegistryItem,
  type RegistryItemKind,
  type RegistryVisualComponentCategory,
  resolveRegistryItemKind,
  resolveVisualComponentCategory,
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
  maps: "map route location geography flow 地图 路径 路线 地理 流向",
  media:
    "media image video split screen device mockup interface ui browser mobile walkthrough cursor 媒体 图片 视频 分屏 样机 界面 浏览器 手机 演示",
  business:
    "business diagram mindmap timeline architecture framework strategy launch keynote 商业图库 商业 图表 思维导图 时间线 架构 框架 战略 发布会",
};

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

export function resolveCatalogSection(item: {
  visualComponent?: { category?: unknown };
}): CatalogSectionId | null {
  return resolveVisualComponentCategory(item.visualComponent?.category);
}

export function useBlockCatalog() {
  const [blocks, setBlocks] = useState<CatalogItem[]>(() => catalogCache ?? []);
  const [loading, setLoading] = useState(() => catalogCache === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const reload = useCallback(async () => {
    await catalogRequest?.catch(() => {});
    catalogCache = null;
    catalogRequest = null;
    setError(null);
    setBlocks(await preloadBlockCatalog());
  }, []);

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
    reload,
  };
}
