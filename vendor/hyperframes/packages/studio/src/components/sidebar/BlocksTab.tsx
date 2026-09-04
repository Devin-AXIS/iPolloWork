import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { CaretDown, CaretRight, FunnelSimple } from "@phosphor-icons/react";
import { formatVisualComponentDataForAi } from "@hyperframes/core/registry";
import {
  useBlockCatalog,
  resolveCatalogSection,
  type CatalogItem,
  type CatalogSection,
  type CatalogSectionId,
} from "../../hooks/useBlockCatalog";
import { getCategoryColors, getCategoryLabel } from "../../utils/blockCategories";
import { usePlayerStore } from "../../player";
import { formatTime } from "../../player/lib/time";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { useStudioI18n } from "../../i18n";
import {
  readStudioUiPreferences,
  writeStudioUiPreferences,
  type CatalogColumnCount,
} from "../../utils/studioUiPreferences";
import { PreviewController } from "./PreviewController";
import searchIconSrc from "../../icons/figmaAssetsSearch.svg?url";

interface BlocksTabProps {
  onAddBlock?: (blockName: string) => Promise<boolean>;
}

const SECTION_TITLES: Record<CatalogSectionId, { en: string; zh: string }> = {
  scene: { en: "Openers & Endings", zh: "开场与收尾" },
  product: { en: "Product Showcase", zh: "产品展示" },
  data: { en: "Data & Charts", zh: "数据与图表" },
  diagrams: { en: "Flows & Diagrams", zh: "流程与图解" },
  maps: { en: "Maps & Routes", zh: "地图与路径" },
  proof: { en: "Comparison & Proof", zh: "对比与背书" },
  knowledge: { en: "Knowledge", zh: "知识讲解" },
  people: { en: "People & Quotes", zh: "人物与观点" },
  typography: { en: "Text & Labels", zh: "文字与标注" },
  media: { en: "Media & UI", zh: "媒体与界面" },
  social: { en: "Social Media", zh: "社交媒体" },
  developer: { en: "Code Demos", zh: "代码演示" },
  brand: { en: "Brand & Marketing", zh: "品牌与营销" },
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const DEFAULT_CATALOG_COLUMN_COUNT: CatalogColumnCount = 2;
const CATALOG_GRID_COLUMNS: Record<CatalogColumnCount, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};
const ALL_SECTIONS_FILTER = "all" as const;
export type ComponentCatalogSection = CatalogSectionId | typeof ALL_SECTIONS_FILTER;

function nextCatalogColumnCount(current: CatalogColumnCount, deltaY: number): CatalogColumnCount {
  if (deltaY > 0) {
    if (current === 1) return 2;
    if (current === 2) return 3;
    return 4;
  }
  if (current === 4) return 3;
  if (current === 3) return 2;
  return 1;
}

function subscribeReducedMotion(callback: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

export const BlocksTab = memo(function BlocksTab({ onAddBlock }: BlocksTabProps) {
  const { locale } = useStudioI18n();
  const { loading, error, search, setSearch, sections } = useBlockCatalog();
  const [previewController] = useState(() => new PreviewController());
  const [activeSection, setActiveSection] = useState<ComponentCatalogSection>(ALL_SECTIONS_FILTER);
  const [insertingBlockName, setInsertingBlockName] = useState<string | null>(null);
  const insertingBlockNameRef = useRef<string | null>(null);
  const [columnCount, setColumnCount] = useState<CatalogColumnCount>(
    () => readStudioUiPreferences().catalogColumnCount ?? DEFAULT_CATALOG_COLUMN_COUNT,
  );
  const lastDensityWheelAtRef = useRef(Number.NEGATIVE_INFINITY);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  useEffect(
    () => () => {
      previewController.dispose();
    },
    [previewController],
  );
  useEffect(() => {
    writeStudioUiPreferences({ catalogColumnCount: columnCount });
  }, [columnCount]);
  useEffect(() => {
    previewController.stop();
  }, [previewController, reducedMotion, search]);

  const handleDensityWheel = useCallback((deltaY: number) => {
    const now = performance.now();
    if (now - lastDensityWheelAtRef.current < 140) return;
    lastDensityWheelAtRef.current = now;
    setColumnCount((current) => nextCatalogColumnCount(current, deltaY));
  }, []);
  const handleInsertBlock = useCallback(
    async (blockName: string): Promise<boolean> => {
      if (!onAddBlock || insertingBlockNameRef.current) return false;

      insertingBlockNameRef.current = blockName;
      setInsertingBlockName(blockName);
      try {
        return await onAddBlock(blockName);
      } finally {
        if (insertingBlockNameRef.current === blockName) {
          insertingBlockNameRef.current = null;
          setInsertingBlockName(null);
        }
      }
    },
    [onAddBlock],
  );
  const totalCount = useMemo(
    () => sections.reduce((total, section) => total + section.items.length, 0),
    [sections],
  );
  const visibleSections = useMemo(() => {
    if (activeSection === ALL_SECTIONS_FILTER) {
      return sections.filter((section) => section.items.length > 0);
    }
    return sections.filter((section) => section.id === activeSection);
  }, [activeSection, sections]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex-shrink-0 space-y-[10px] border-b border-panel-border px-4 pb-[14px] pt-3">
        <div className="relative">
          <img
            src={searchIconSrc}
            alt=""
            className="pointer-events-none absolute left-[11px] top-1/2 h-4 w-4 -translate-y-1/2"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={locale === "zh" ? "搜索组件…" : "Search components…"}
            aria-label={locale === "zh" ? "搜索组件" : "Search components"}
            data-testid="block-catalog-search"
            className="h-[34px] w-full rounded-lg border-0 bg-panel-input pl-9 pr-3 text-[13px] text-panel-text-1 outline-none transition-shadow placeholder:text-[#a2a6af] focus:ring-1 focus:ring-[#1FBAC0]/50"
          />
        </div>
        <label className="grid gap-[5px] text-[10px] font-medium leading-3 text-panel-text-3">
          {locale === "zh" ? "分类" : "Category"}
          <select
            value={activeSection}
            onChange={(event) => {
              const nextSection = event.target.value;
              if (nextSection === ALL_SECTIONS_FILTER) {
                setActiveSection(ALL_SECTIONS_FILTER);
                return;
              }
              const match = sections.find((section) => section.id === nextSection);
              if (match) setActiveSection(match.id);
            }}
            aria-label={locale === "zh" ? "组件分类" : "Component category"}
            className="h-[34px] w-full rounded-lg border-0 bg-panel-input px-[11px] text-[13px] font-medium text-panel-text-1 outline-none focus:ring-1 focus:ring-[#1FBAC0]/50"
          >
            <option value={ALL_SECTIONS_FILTER}>
              {locale === "zh" ? "全部组件" : "All components"} · {totalCount}
            </option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {SECTION_TITLES[section.id][locale]} · {section.items.length}
              </option>
            ))}
          </select>
        </label>
        <div
          className="rounded-lg bg-panel-input px-3 py-2 text-[10px] leading-4 text-panel-text-3"
          data-testid="components-catalog-help"
        >
          {locale === "zh"
            ? "组件会继承当前主题，插入时间线后可继续调整变量，也可以交给 AI 做受控修改。"
            : "Components inherit the active theme, expose safe variables after insertion, and remain available to AI for controlled edits."}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-neutral-500">
          {locale === "zh" ? "正在加载预设..." : "Loading presets..."}
        </div>
      ) : error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-red-400">
          {locale === "zh"
            ? "预设加载失败，请重新打开面板。"
            : "Presets failed to load. Reopen the panel."}
        </div>
      ) : (
        <CatalogSectionGrid
          sections={visibleSections}
          search={search}
          locale={locale}
          reducedMotion={reducedMotion}
          columnCount={columnCount}
          onDensityWheel={handleDensityWheel}
          previewController={previewController}
          onAddBlock={onAddBlock ? handleInsertBlock : undefined}
          insertingBlockName={insertingBlockName}
          showSectionHeaders
          testId="block-catalog-components"
        />
      )}
    </div>
  );
});

function CatalogSectionGrid({
  sections,
  search,
  locale,
  reducedMotion,
  columnCount,
  onDensityWheel,
  previewController,
  onAddBlock,
  insertingBlockName,
  showSectionHeaders,
  testId,
}: {
  sections: CatalogSection[];
  search: string;
  locale: "en" | "zh";
  reducedMotion: boolean;
  columnCount: CatalogColumnCount;
  onDensityWheel: (deltaY: number) => void;
  previewController: PreviewController;
  onAddBlock?: (blockName: string) => Promise<boolean>;
  insertingBlockName: string | null;
  showSectionHeaders: boolean;
  testId: string;
}) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [visibleNames, setVisibleNames] = useState<Set<string>>(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<CatalogSectionId>>(
    () => new Set(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const cardElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  const toggleSection = useCallback((section: CatalogSectionId) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const registerCard = useCallback((name: string, element: HTMLElement | null) => {
    const previous = cardElementsRef.current.get(name);
    if (previous && previous !== element) observerRef.current?.unobserve(previous);

    if (element) {
      cardElementsRef.current.set(name, element);
      observerRef.current?.observe(element);
      return;
    }

    cardElementsRef.current.delete(name);
    setVisibleNames((current) => {
      if (!current.has(name)) return current;
      const next = new Set(current);
      next.delete(name);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!scrollRoot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleNames((current) => {
          const next = new Set(current);
          let changed = false;
          for (const entry of entries) {
            const name = entry.target.getAttribute("data-block-name");
            if (!name) continue;
            if (entry.isIntersecting) {
              if (!next.has(name)) {
                next.add(name);
                changed = true;
              }
            } else if (next.delete(name)) {
              changed = true;
            }
          }
          return changed ? next : current;
        });
      },
      { root: scrollRoot, rootMargin: "240px 0px", threshold: 0 },
    );
    observerRef.current = observer;
    for (const element of cardElementsRef.current.values()) observer.observe(element);

    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [scrollRoot]);

  useEffect(() => {
    if (scrollRoot) scrollRoot.scrollTop = 0;
  }, [scrollRoot, search, sections]);

  useEffect(() => {
    if (!scrollRoot) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      onDensityWheel(event.deltaY);
    };
    scrollRoot.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollRoot.removeEventListener("wheel", handleWheel);
  }, [onDensityWheel, scrollRoot]);

  const itemCount = sections.reduce((total, section) => total + section.items.length, 0);
  return (
    <div
      ref={setScrollRoot}
      className="hf-block-catalog-scroll min-h-0 min-w-0 flex-1 overscroll-contain px-4 pb-4"
      data-testid={testId}
      data-catalog-columns={columnCount}
      tabIndex={0}
      aria-label={locale === "zh" ? "组件列表" : "Component list"}
    >
      {itemCount === 0 ? (
        <div className="flex h-full min-h-16 items-center justify-center px-3 text-center text-[10px] text-neutral-600">
          {locale === "zh" ? "此分类暂无组件" : "No components in this category yet"}
        </div>
      ) : (
        <div>
          {sections.map((section) => (
            <section
              key={section.id}
              className={`border-b border-panel-border last:border-b-0 ${collapsedSections.has(section.id) ? "" : "pb-4"}`}
              data-testid={`catalog-section-${section.id}`}
            >
              {showSectionHeaders ? (
                <CatalogSectionHeader
                  title={SECTION_TITLES[section.id][locale]}
                  count={section.items.length}
                  collapsed={collapsedSections.has(section.id)}
                  onToggle={() => toggleSection(section.id)}
                />
              ) : null}
              {!collapsedSections.has(section.id) ? (
                <div
                  className={`grid min-w-0 gap-x-[10px] gap-y-4 overflow-x-hidden ${CATALOG_GRID_COLUMNS[columnCount]}`}
                  data-testid={`catalog-grid-${section.id}`}
                >
                  {section.items.map((block) => (
                    <BlockCard
                      key={block.name}
                      block={block}
                      visible={visibleNames.has(block.name)}
                      reducedMotion={reducedMotion}
                      registerCard={registerCard}
                      previewController={previewController}
                      locale={locale}
                      onAddBlock={onAddBlock}
                      insertingBlockName={insertingBlockName}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogSectionHeader({
  title,
  count,
  collapsed,
  onToggle,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className={`relative -mx-4 flex h-12 w-[calc(100%+32px)] items-center gap-2 px-4 text-left text-panel-text-1 transition-colors hover:bg-panel-input/50 ${collapsed ? "" : "mb-[14px]"}`}
    >
      <span className="absolute inset-y-0 left-0 w-[3px] bg-[#1FBAC0]" aria-hidden="true" />
      {collapsed ? (
        <CaretRight
          aria-hidden="true"
          size={10}
          weight="regular"
          className="flex-none text-[#a2a6af]"
        />
      ) : (
        <CaretDown
          aria-hidden="true"
          size={10}
          weight="regular"
          className="flex-none text-[#a2a6af]"
        />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
      <span className="text-xs tabular-nums text-panel-text-3">{count}</span>
      <FunnelSimple aria-hidden="true" className="h-4 w-4 flex-none text-panel-text-3" />
    </button>
  );
}

interface CompositionContext {
  currentTime: number;
  activeCompPath: string | null;
  elements: Array<{
    id: string;
    start: number;
    duration: number;
    track: number;
    label?: string;
    compositionSrc?: string;
  }>;
  compositionDimensions?: { width: number; height: number };
}

function formatCompositionContext(ctx: CompositionContext): string {
  const lines: string[] = [
    `Playback time: ${formatTime(ctx.currentTime)}`,
    `Active composition: ${ctx.activeCompPath || "index.html"}`,
  ];
  if (ctx.compositionDimensions) {
    lines.push(
      `Dimensions: ${ctx.compositionDimensions.width}x${ctx.compositionDimensions.height}`,
    );
  }
  const visibleNow = ctx.elements.filter(
    (element) =>
      ctx.currentTime >= element.start && ctx.currentTime < element.start + element.duration,
  );
  if (visibleNow.length > 0) {
    lines.push(
      "",
      `Elements visible at ${formatTime(ctx.currentTime)}:`,
      ...visibleNow.map(
        (element) =>
          `- ${element.label || element.id} (track ${element.track}, ${formatTime(element.start)}-${formatTime(element.start + element.duration)}${element.compositionSrc ? `, src: ${element.compositionSrc}` : ""})`,
      ),
    );
  }
  lines.push("", `Highest track index: ${ctx.elements.length}`);
  return lines.join("\n");
}

function buildAgentPrompt(block: CatalogItem, context: CompositionContext): string {
  const { title, name, description } = block;
  const compositionInfo = formatCompositionContext(context);

  if (block.visualComponent) {
    const slots = block.visualComponent.ai?.slots.join(", ") ?? "declared component slots";
    const dataContract = block.visualComponent.data;
    const dataVariable = dataContract
      ? block.variables?.find((variable) => variable.id === dataContract.binding.variable)
      : undefined;
    const aiReadableData =
      dataContract && dataVariable?.type === "string"
        ? formatVisualComponentDataForAi(dataContract, dataVariable.default)
        : undefined;
    return [
      `Using /hyperframes, add the reusable visual component "${title}" (registry: ${name}) to my composition.`,
      description,
      `Keep its theme mode as ${block.visualComponent.themeMode}. Prefer its declared variables for routine changes. AI-editable slots: ${slots}.`,
      block.visualComponent.ai?.instructions ??
        "Preserve its registered timeline and only make bounded layout or content adjustments.",
      ...(aiReadableData
        ? [
            "## AI-readable component data",
            "Use this semantic contract instead of guessing or editing the compact storage syntax. Respect column types, units, row limits, mode, and allowed operations.",
            `\`\`\`json\n${aiReadableData}\n\`\`\``,
          ]
        : []),
      "",
      "## Current composition state",
      "",
      compositionInfo,
    ].join("\n\n");
  }

  const instruction = [
    `Using /hyperframes, add the reusable visual component "${title}" (registry: ${name}) to my composition.`,
    description,
    "Preserve the registered component contract, inherit the active theme, and prefer its declared variables for routine changes.",
  ].join("\n\n");

  return [instruction, "", "## Current composition state", "", compositionInfo].join("\n");
}

const BlockCard = memo(function BlockCard({
  block,
  visible,
  reducedMotion,
  registerCard,
  previewController,
  onAddBlock,
  insertingBlockName,
  locale,
}: {
  block: CatalogItem;
  visible: boolean;
  reducedMotion: boolean;
  registerCard: (name: string, element: HTMLElement | null) => void;
  previewController: PreviewController;
  onAddBlock?: (blockName: string) => Promise<boolean>;
  insertingBlockName: string | null;
  locale: "en" | "zh";
}) {
  const visualSection = resolveCatalogSection(block);
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoThumbnailFailed, setVideoThumbnailFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const colors = getCategoryColors(block.category);
  const duration = block.type === "hyperframes:component" ? undefined : block.duration;
  const posterUrl = block.preview?.poster;
  const videoUrl = block.preview?.video;
  const registryPreviewUrl = `/api/registry/blocks/${encodeURIComponent(block.name)}/preview`;
  const compositionPosterUrl = `${registryPreviewUrl}?time=${Math.min((duration ?? 4) / 2, 2).toFixed(2)}`;
  const compositionPlaybackUrl = `${registryPreviewUrl}?autoplay=1`;
  const prefersCompositionPreview =
    block.type === "hyperframes:component" && block.librarySection === "caption-animation";
  const canShowPoster =
    visible && !prefersCompositionPreview && Boolean(posterUrl) && !posterFailed;
  const canShowVideoThumbnail =
    visible &&
    !prefersCompositionPreview &&
    Boolean(videoUrl) &&
    (!posterUrl || posterFailed) &&
    !videoThumbnailFailed;
  const canShowCompositionThumbnail =
    visible &&
    Boolean(compositionPosterUrl) &&
    (prefersCompositionPreview ||
      ((!videoUrl || videoThumbnailFailed) && (!posterUrl || posterFailed)));
  const needsWebGL = block.tags?.includes("html-in-canvas") || block.tags?.includes("webgl");
  const insertionBusy = insertingBlockName !== null;
  const adding = insertingBlockName === block.name;

  const setCardRef = useCallback(
    (element: HTMLDivElement | null) => registerCard(block.name, element),
    [block.name, registerCard],
  );

  const clearHoverTimer = useCallback(() => {
    if (!hoverTimerRef.current) return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  const startPreview = useCallback(() => {
    if (reducedMotion) return;
    previewController.start(block.name, async ({ isCurrent }) => {
      if (!isCurrent()) return undefined;
      if (mountedRef.current) {
        setPreviewReady(false);
        setPreviewing(true);
      }

      return () => {
        if (mountedRef.current) {
          setPreviewing(false);
          setPreviewReady(false);
        }
      };
    });
  }, [block.name, previewController, reducedMotion]);

  const handleEnter = useCallback(() => {
    clearHoverTimer();
    if (reducedMotion) return;
    hoverTimerRef.current = setTimeout(startPreview, 60);
  }, [clearHoverTimer, reducedMotion, startPreview]);

  const handleLeave = useCallback(() => {
    clearHoverTimer();
    previewController.stop(block.name);
  }, [block.name, clearHoverTimer, previewController]);

  useEffect(() => {
    if (!visible) handleLeave();
  }, [handleLeave, visible]);

  useEffect(() => {
    setPosterFailed(false);
  }, [posterUrl]);

  useEffect(() => {
    setVideoThumbnailFailed(false);
  }, [videoUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHoverTimer();
      previewController.stop(block.name);
      registerCard(block.name, null);
    };
  }, [block.name, clearHoverTimer, previewController, registerCard]);

  const handleAdd = useCallback(() => {
    if (insertionBusy || !onAddBlock) return;
    void onAddBlock(block.name);
  }, [block.name, insertionBusy, onAddBlock]);

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleAdd();
    },
    [handleAdd],
  );

  const { activeCompPath, compositionDimensions } = useStudioShellContext();
  const handleShowPrompt = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const state = usePlayerStore.getState();
      const context: CompositionContext = {
        currentTime: state.currentTime,
        activeCompPath,
        elements: state.elements.map((element) => ({
          id: element.id,
          start: element.start,
          duration: element.duration,
          track: element.track,
          label: element.label,
          compositionSrc: element.compositionSrc,
        })),
        compositionDimensions: compositionDimensions ?? undefined,
      };
      const prompt = buildAgentPrompt(block, context);
      window.parent.postMessage(
        {
          type: "ipollowork:hyperframes:animation-reference",
          animation: {
            name: block.name,
            title: block.title,
            description: block.description,
            type: block.type,
            category: block.category,
            visualComponent: block.visualComponent,
            tags: block.tags ?? [],
            duration,
            preview: { poster: posterUrl, video: videoUrl },
            agentPrompt: prompt,
          },
        },
        "*",
      );
    },
    [activeCompPath, block, compositionDimensions, duration, posterUrl, videoUrl],
  );

  return (
    <div
      ref={setCardRef}
      role="button"
      tabIndex={insertionBusy ? -1 : 0}
      aria-disabled={insertionBusy}
      aria-busy={adding || undefined}
      className={`group/card min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/60 ${insertionBusy ? "cursor-not-allowed" : "cursor-pointer"}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "160px" }}
      data-testid="block-catalog-card"
      data-block-name={block.name}
      draggable={!insertionBusy}
      onClick={handleAdd}
      onKeyDown={handleCardKeyDown}
      onDragStart={(event) => {
        if (insertionBusy) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(
          TIMELINE_BLOCK_MIME,
          JSON.stringify({ name: block.name, dimensions: block.dimensions }),
        );
        event.dataTransfer.setData("text/plain", block.name);
        handleLeave();
      }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      <div className="relative aspect-[14/9] w-full overflow-hidden rounded-lg border border-panel-border bg-panel-input transition-shadow group-hover/card:shadow-[0_3px_12px_rgba(0,0,0,0.12)]">
        {canShowPoster ? (
          <img
            src={posterUrl}
            alt=""
            loading="lazy"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : canShowVideoThumbnail ? (
          <video
            src={videoUrl}
            aria-hidden="true"
            muted
            playsInline
            preload="auto"
            onError={() => setVideoThumbnailFailed(true)}
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
        ) : canShowCompositionThumbnail ? (
          <iframe
            src={compositionPosterUrl}
            title={`${block.title} preview`}
            tabIndex={-1}
            loading="lazy"
            sandbox="allow-scripts"
            className="pointer-events-none absolute inset-0 size-full border-0 bg-black"
          />
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center ${colors.bg}`}>
            <div className="flex min-w-0 flex-col items-center gap-1 px-2 text-center">
              <span className={`max-w-full truncate text-[7px] font-medium ${colors.text}`}>
                {block.visualComponent ? block.title : getCategoryLabel(block.category, locale)}
              </span>
            </div>
          </div>
        )}

        {previewing ? (
          <iframe
            src={compositionPlaybackUrl}
            title={`${block.title} preview`}
            tabIndex={-1}
            sandbox="allow-scripts"
            onLoad={() => setPreviewReady(true)}
            className={`pointer-events-none absolute inset-0 z-[1] size-full border-0 bg-transparent transition-opacity duration-150 ${
              previewReady ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : null}

        <div className="pointer-events-none absolute left-1 top-1 z-[2] flex items-center gap-0.5">
          {block.engine?.name.toLowerCase() === "gsap" ? (
            <span className="rounded bg-[#174d42] px-1.5 py-1 text-[7px] font-semibold leading-none text-[#6de0c1]">
              {block.source?.provider === "gsap-docs"
                ? "GSAP Official"
                : block.source?.provider === "gsap-demo-hub"
                  ? "Demo Hub"
                  : "GSAP"}
            </span>
          ) : null}
        </div>
        <div className="pointer-events-none absolute right-1 top-1 z-[2] flex items-center gap-0.5">
          {needsWebGL ? (
            <span className="rounded bg-purple-900/80 px-1.5 py-1 text-[7px] font-semibold leading-none text-purple-200">
              WebGL
            </span>
          ) : null}
          {duration != null ? (
            <span className="rounded bg-white/90 px-1.5 py-1 text-[8px] font-semibold leading-none text-[#4d5159] shadow-sm">
              {duration}s
            </span>
          ) : null}
        </div>
      </div>

      <div className="pt-[7px]">
        <div className="flex min-w-0 items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1 truncate text-[10px] font-medium leading-4 text-panel-text-1">
            {block.title}
          </div>
          <span className="flex-none text-[9px] leading-4 text-panel-text-3">
            {visualSection
              ? SECTION_TITLES[visualSection][locale]
              : getCategoryLabel(block.category, locale)}
          </span>
        </div>
        {block.engine?.plugins?.[0] ? (
          <div className="mt-0.5 truncate text-[8px] text-[#209b83]">{block.engine.plugins[0]}</div>
        ) : null}
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={insertionBusy}
            aria-busy={adding || undefined}
            onClick={(event) => {
              event.stopPropagation();
              handleAdd();
            }}
            title={
              locale === "zh"
                ? "在当前播放位置插入组件，并将后续片段顺延"
                : "Insert component at the playhead and ripple later clips"
            }
            className="flex h-7 min-w-0 items-center justify-center rounded-md border border-panel-border bg-panel-bg px-1 text-[9px] font-semibold text-panel-text-1 transition-colors enabled:hover:bg-panel-input disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="truncate">
              {adding
                ? locale === "zh"
                  ? "插入中…"
                  : "Inserting…"
                : locale === "zh"
                  ? "插入组件"
                  : "Insert component"}
            </span>
          </button>
          <button
            type="button"
            disabled={insertionBusy}
            onClick={handleShowPrompt}
            title={
              locale === "zh"
                ? "让 AI 在组件变量与可编辑槽位内调整"
                : "Ask AI to adapt this component within its declared slots"
            }
            className="flex h-7 min-w-0 items-center justify-center rounded-md bg-panel-input px-1 text-[9px] font-medium text-panel-text-1 transition-colors enabled:hover:bg-[#1FBAC0]/12 enabled:hover:text-[#168e92] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="truncate">{locale === "zh" ? "\u4ea4\u7ed9 AI" : "Ask AI"}</span>
          </button>
        </div>
      </div>
    </div>
  );
});
