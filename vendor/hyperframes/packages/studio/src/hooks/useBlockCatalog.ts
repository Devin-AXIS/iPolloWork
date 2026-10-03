import { useEffect, useMemo, useState } from "react";
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
  scene: "scene intro opening outro ending title cta 开场 片头 收尾 结尾 片尾 行动",
  product: "product feature spotlight demo showcase 产品 功能 亮点 展示",
  data:
    "data chart metrics structured ranking matrix dashboard table 数据 图表 指标 结构 排名 矩阵 仪表盘 表格",
  diagrams:
    "diagram architecture framework flow process timeline roadmap cycle 图解 架构 流程 时间线 路线图 循环",
  maps: "map route location geography flow 地图 路径 路线 地理 流向",
  proof:
    "proof evidence source testimonial compare before after rating 证据 背书 评价 对比 前后 评分",
  knowledge: "knowledge education explain 知识 教育 讲解",
  people: "people profile quote team 人物 团队 观点 引用",
  typography:
    "typography text lower third chapter bullet quote label 文字 标注 字幕 章节 列表 引语",
  media:
    "media image video split screen device mockup interface ui browser mobile walkthrough cursor 媒体 图片 视频 分屏 样机 界面 浏览器 手机 演示",
  social:
    "social media post comment follow creator instagram x douyin xiaohongshu 社交媒体 帖子 评论 关注 创作者 抖音 小红书",
  developer: "developer code terminal diff api demo 代码演示 代码 终端 差异 接口",
  brand:
    "brand marketing commerce logo palette campaign identity pricing offer sale 品牌 营销 商业 标志 色板 活动 定价 报价 促销",
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
