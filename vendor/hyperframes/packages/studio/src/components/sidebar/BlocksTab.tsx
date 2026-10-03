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
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ListFilter, Plus, Search, Sparkles, X } from "lucide-react";
import { FlatDropdown } from "../editor/propertyPanelFlatSelectRow";
import { Tooltip } from "../ui/Tooltip";
import { useDialogBehavior } from "../ui/useDialogBehavior";
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

  useEffect(() => {
    previewController.activate();
    return () => {
      previewController.dispose();
    };
  }, [previewController]);
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
      <div className="flex-shrink-0 border-b border-panel-border px-4 pb-[14px]">
        <div className="flex items-center gap-2" data-testid="component-catalog-toolbar">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[#a2a6af]"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={locale === "zh" ? "搜索组件…" : "Search components…"}
              aria-label={locale === "zh" ? "搜索组件" : "Search components"}
              data-testid="block-catalog-search"
              className="h-[34px] w-full rounded-lg border-0 bg-panel-input pl-9 pr-3 text-xs text-panel-text-1 outline-none transition-shadow placeholder:text-panel-text-4 focus:ring-1 focus:ring-[#1FBAC0]/50"
            />
          </div>
          <FlatDropdown
            value={activeSection}
            onChange={nextSection => {
              if (nextSection === ALL_SECTIONS_FILTER) setActiveSection(ALL_SECTIONS_FILTER);
              else {
                const match = sections.find(section => section.id === nextSection);
                if (match) setActiveSection(match.id);
              }
            }}
            ariaLabel={locale === "zh" ? "组件分类" : "Component category"}
            options={[
              {value: ALL_SECTIONS_FILTER, label: `${locale === "zh" ? "全部组件" : "All components"} · ${totalCount}`},
              ...sections.map(section => ({value: section.id, label: `${SECTION_TITLES[section.id][locale]} · ${section.items.length}`})),
            ]}
            icon={<ListFilter aria-hidden="true" size={16} strokeWidth={1.5} className="mx-auto" />}
            menuWidth={208}
            className={`h-[34px] w-[34px] shrink-0 rounded-lg border-0 transition-colors hover:bg-panel-hover ${activeSection === ALL_SECTIONS_FILTER ? "bg-panel-input text-panel-text-2" : "bg-panel-accent/15 text-panel-accent"}`}
          />
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
              className={`-mx-4 border-b border-panel-border ${collapsedSections.has(section.id) ? "" : "pb-4"}`}
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
                  className={`grid min-w-0 gap-x-[10px] gap-y-4 overflow-x-hidden px-4 ${CATALOG_GRID_COLUMNS[columnCount]}`}
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
      data-testid="component-section-header"
      onClick={onToggle}
      className={`hf-panel-accordion-header w-full ${collapsed ? "" : "mb-[14px]"}`}
    >
      {collapsed ? (
        <ChevronRight
          aria-hidden="true"
          size={14}
          strokeWidth={1.5}
          className="hf-panel-accordion-chevron"
        />
      ) : (
        <ChevronDown
          aria-hidden="true"
          size={14}
          strokeWidth={1.5}
          className="hf-panel-accordion-chevron"
        />
      )}
      <span className="hf-panel-accordion-label min-w-0 flex-1 truncate">{title}</span>
      <span className="hf-panel-accordion-count">{count}</span>
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
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoThumbnailFailed, setVideoThumbnailFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useDialogBehavior({ open: previewOpen, onClose: () => setPreviewOpen(false), containerRef: dialogRef });
  const [previewReady, setPreviewReady] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const colors = getCategoryColors(block.category);
  const duration = block.type === "hyperframes:component" ? undefined : block.duration;
  const posterUrl = block.preview?.poster;
  const videoUrl = block.preview?.video;
  const previewRatio = block.dimensions ? block.dimensions.width / block.dimensions.height : 16 / 9;
  const thumbnailFrameStyle = {
    width: `max(100%, ${100 * previewRatio}px)`,
    height: `max(100px, calc(100cqw / ${previewRatio}))`,
  };
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

  const handleAdd = useCallback(async (): Promise<boolean> => {
    if (insertionBusy || !onAddBlock) return false;
    const added = await onAddBlock(block.name);
    if (added) setPreviewOpen(false);
    return added;
  }, [block.name, insertionBusy, onAddBlock]);

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setPreviewOpen(true);
    },
    [],
  );

  const { activeCompPath, compositionDimensions } = useStudioShellContext();
  const handleShowPrompt = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      setPreviewOpen(false);
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

  const insertLabel = adding ? (locale === "zh" ? "插入中…" : "Inserting…") : (locale === "zh" ? "插入组件" : "Insert component");
  const askLabel = locale === "zh" ? "问 AI" : "Ask AI";
  const insertAction = <button type="button" disabled={insertionBusy || !onAddBlock} aria-label={insertLabel} aria-busy={adding || undefined} onClick={event => { event.stopPropagation(); void handleAdd(); }} className="flex h-7 items-center gap-1 rounded-md bg-panel-input px-2 text-xs font-medium text-panel-text-1 shadow-sm transition-colors hover:bg-panel-hover disabled:opacity-50"><Plus aria-hidden="true" size={16} strokeWidth={1.5} className="shrink-0 text-panel-text-2" /><span>{insertLabel}</span></button>;
  const askAction = <Tooltip label={askLabel}><button type="button" disabled={insertionBusy} aria-label={askLabel} onClick={handleShowPrompt} className="flex size-7 items-center justify-center rounded-md bg-panel-input text-panel-text-1 shadow-sm transition-colors hover:bg-panel-hover disabled:opacity-50"><Sparkles aria-hidden="true" size={16} strokeWidth={1.5} className="shrink-0 text-panel-text-2" /></button></Tooltip>;

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
      data-preview-active={previewing ? "true" : "false"}
      draggable={!insertionBusy}
      onClick={() => setPreviewOpen(true)}
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
      <div style={{ containerType: "size" }} className="relative h-[100px] w-full overflow-hidden rounded-lg border border-panel-border bg-panel-input ">
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
            style={thumbnailFrameStyle}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-0 bg-black"
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
            style={thumbnailFrameStyle}
            className={`pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent transition-opacity duration-150 ${
              previewReady ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : null}

        <div className="pointer-events-none absolute left-2 bottom-2 z-[2] flex items-center gap-0.5">
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
        <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/65 via-transparent to-transparent opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100">
          <div className="pointer-events-auto absolute right-2 top-2">{askAction}</div>
          <div className="pointer-events-auto absolute bottom-2 right-2">{insertAction}</div>
        </div>
        <span aria-hidden="true" data-testid="component-card-hover-border" className="pointer-events-none absolute inset-0 z-[4] rounded-[inherit] border-2 border-[#1FBAC0] opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100" />
      </div>

      <div className="pt-1">
        <div className="flex min-w-0 items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1 truncate text-xs font-medium leading-5 text-panel-text-1">
            {block.title}
          </div>
        </div>
      </div>
      {previewOpen ? createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) requestClose(); }}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={block.title} tabIndex={-1} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg text-panel-text-1">
          <div className="flex items-center justify-between gap-3 p-3"><span className="truncate text-sm font-medium">{block.title}</span><Tooltip label={locale === "zh" ? "关闭" : "Close"}><button type="button" aria-label={locale === "zh" ? "关闭" : "Close"} onClick={requestClose} className="flex size-7 items-center justify-center rounded-md hover:bg-panel-input"><X aria-hidden="true" size={16} strokeWidth={1.5} /></button></Tooltip></div>
          <iframe src={compositionPlaybackUrl} title={block.title} sandbox="allow-scripts" className="aspect-video min-h-0 w-full border-0 bg-panel-input" />
          <div className="flex shrink-0 items-center justify-end gap-2 p-3">{askAction}{insertAction}</div>
        </div>
      </div>, document.body) : null}
    </div>
  );
});
