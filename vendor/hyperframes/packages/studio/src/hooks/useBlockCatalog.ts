import { useState, useEffect, useMemo } from "react";
import {
  GSAP_OFFICIAL_CAPABILITIES,
  type RegistryItem,
  type RegistryItemKind,
  resolveRegistryItemKind,
} from "@hyperframes/core/registry";
import {
  BLOCK_CATEGORIES,
  type BlockCategory,
  resolveBlockCategory,
} from "../utils/blockCategories";

export type CatalogItem = RegistryItem & {
  category: BlockCategory;
  kind: RegistryItemKind;
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

export function useBlockCatalog(kind: RegistryItemKind) {
  const [blocks, setBlocks] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<BlockCategory | null>(null);
  const [capability, setCapability] = useState<string | null>(null);

  // fallow-ignore-next-line complexity
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/registry/blocks");
        if (!res.ok) throw new Error("Failed to load catalog");
        const data = (await res.json()) as RegistryItem[];
        if (cancelled) return;
        const items = data
          .map((block) => ({
            ...block,
            category: resolveBlockCategory(block.tags),
            kind: resolveRegistryItemKind(block),
          }))
          .sort((a, b) => {
            const ia = BLOCK_CATEGORIES.findIndex((c) => c.id === a.category);
            const ib = BLOCK_CATEGORIES.findIndex((c) => c.id === b.category);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          });
        setBlocks(items);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredBlocks = useMemo(() => {
    let result = blocks.filter(
      (block) => isGsapCatalogItem(block) && block.kind === kind,
    );
    if (category) {
      result = result.filter((b) => b.category === category);
    }
    if (capability) {
      result = result.filter((block) => block.engine?.plugins?.includes(capability));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          b.tags?.some((t) => t.toLowerCase().includes(q)) ||
          b.engine?.plugins?.some((plugin) => plugin.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [blocks, capability, category, kind, search]);

  const kindBlocks = useMemo(
    () => blocks.filter((block) => isGsapCatalogItem(block) && block.kind === kind),
    [blocks, kind],
  );
  const capabilities = useMemo(
    () =>
      GSAP_OFFICIAL_CAPABILITIES.filter((official) =>
        kindBlocks.some((block) => block.engine?.plugins?.includes(official.runtimeName)),
      ).map((official) => official.runtimeName),
    [kindBlocks],
  );
  const coverage = useMemo(() => resolveGsapCatalogCoverage(blocks), [blocks]);

  return {
    blocks,
    loading,
    error,
    search,
    setSearch,
    category,
    setCategory,
    capability,
    setCapability,
    capabilities,
    kindBlocks,
    coverage,
    filteredBlocks,
  };
}
