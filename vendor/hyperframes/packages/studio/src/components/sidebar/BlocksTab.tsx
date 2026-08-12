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
import {
  useBlockCatalog,
  type CatalogItem,
  type CatalogPage,
  type CatalogSection,
  type AnimationLibrarySection,
} from "../../hooks/useBlockCatalog";
import {
  getCategoryColors,
  getCategoryLabel,
  type BlockCategory,
} from "../../utils/blockCategories";
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
import type { EffectInsertIntent } from "../../utils/blockInstaller";

interface BlocksTabProps {
  page?: CatalogPage;
  onAddBlock?: (blockName: string, intent?: EffectInsertIntent) => Promise<boolean>;
}

const SECTION_TITLES: Record<AnimationLibrarySection, { en: string; zh: string }> = {
  "opening-effect": { en: "Opening effects", zh: "开头特效" },
  "ending-effect": { en: "Ending effects", zh: "结尾特效" },
  "transition-effect": { en: "Transition effects", zh: "转场特效" },
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
type CatalogSectionFilter = AnimationLibrarySection | typeof ALL_SECTIONS_FILTER;

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

export const BlocksTab = memo(function BlocksTab({ page = "effects", onAddBlock }: BlocksTabProps) {
  const { locale } = useStudioI18n();
  const { loading, error, search, setSearch, sections } = useBlockCatalog(page);
  const [previewController] = useState(() => new PreviewController());
  const [activeSection, setActiveSection] = useState<CatalogSectionFilter>(ALL_SECTIONS_FILTER);
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
  }, [page, previewController, reducedMotion, search]);

  const handleDensityWheel = useCallback((deltaY: number) => {
    const now = performance.now();
    if (now - lastDensityWheelAtRef.current < 140) return;
    lastDensityWheelAtRef.current = now;
    setColumnCount((current) => nextCatalogColumnCount(current, deltaY));
  }, []);
  const totalCount = useMemo(
    () => sections.reduce((total, section) => total + section.items.length, 0),
    [sections],
  );
  const visibleSections = useMemo(
    () =>
      activeSection === ALL_SECTIONS_FILTER
        ? sections
        : sections.filter((section) => section.id === activeSection),
    [activeSection, sections],
  );
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
            placeholder={locale === "zh" ? "搜索特效片段…" : "Search effect clips…"}
            aria-label={locale === "zh" ? "搜索特效片段" : "Search effect clips"}
            data-testid="block-catalog-search"
            className="h-[34px] w-full rounded-lg border-0 bg-panel-input pl-9 pr-3 text-[13px] text-panel-text-1 outline-none transition-shadow placeholder:text-[#a2a6af] focus:ring-1 focus:ring-[#20bbc0]/50"
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
            aria-label={locale === "zh" ? "特效分类" : "Effect category"}
            className="h-[34px] w-full rounded-lg border-0 bg-panel-input px-[11px] text-[13px] font-medium text-panel-text-1 outline-none focus:ring-1 focus:ring-[#20bbc0]/50"
          >
            <option value={ALL_SECTIONS_FILTER}>
              {locale === "zh" ? "全部特效" : "All effects"} · {totalCount}
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
          data-testid="effect-clip-placement-help"
        >
          {locale === "zh"
            ? "特效会作为独立片段插入时间线：开头自动顺延内容，结尾追加到末尾，转场落在相邻片段交界处。"
            : "Effects are inserted as timeline clips: openings shift content, endings append, and transitions use adjacent clip boundaries."}
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
          onAddBlock={onAddBlock}
          showSectionHeaders
          testId={`block-catalog-${page}`}
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
  onAddBlock?: (blockName: string, intent?: EffectInsertIntent) => Promise<boolean>;
  showSectionHeaders: boolean;
  testId: string;
}) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [visibleNames, setVisibleNames] = useState<Set<string>>(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<AnimationLibrarySection>>(
    () => new Set(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const cardElementsRef = useRef<Map<string, HTMLElement>>(new Map());

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
      aria-label={locale === "zh" ? "特效片段列表" : "Effect clip list"}
    >
      {itemCount === 0 ? (
        <div className="flex h-full min-h-16 items-center justify-center px-3 text-center text-[10px] text-neutral-600">
          {locale === "zh" ? "没有匹配的特效片段" : "No matching effect clips"}
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
                <button
                  type="button"
                  aria-expanded={!collapsedSections.has(section.id)}
                  onClick={() => {
                    setCollapsedSections((current) => {
                      const next = new Set(current);
                      if (next.has(section.id)) next.delete(section.id);
                      else next.add(section.id);
                      return next;
                    });
                  }}
                  className={`relative -mx-4 flex h-12 w-[calc(100%+32px)] items-center gap-2 px-4 text-left text-panel-text-1 transition-colors hover:bg-panel-input/50 ${collapsedSections.has(section.id) ? "" : "mb-[14px]"}`}
                >
                  <span
                    className="absolute inset-y-0 left-0 w-[3px] bg-[#20bbc0]"
                    aria-hidden="true"
                  />
                  {collapsedSections.has(section.id) ? (
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
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {SECTION_TITLES[section.id][locale]}
                  </span>
                  <span className="text-xs tabular-nums text-panel-text-3">
                    {section.items.length}
                  </span>
                  <FunnelSimple
                    aria-hidden="true"
                    className="h-4 w-4 flex-none text-panel-text-3"
                  />
                </button>
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

function buildAgentPrompt(
  title: string,
  name: string,
  description: string,
  category: BlockCategory,
  blockType: string,
  context: CompositionContext,
): string {
  const isComponent = blockType === "hyperframes:component";
  const kind = isComponent ? "component" : "block";
  const compositionInfo = formatCompositionContext(context);

  const categoryPrompts: Record<string, string> = {
    captions: [
      `Using /hyperframes, add the "${title}" caption style (registry: ${name}) to my composition.`,
      description,
      "Transcribe the audio with /media-use, then wire the transcript into this caption component. Match the font colors and animation timing to my composition's design tokens. Place it as an overlay above the main content with the highest z-index.",
    ].join("\n\n"),
    vfx: [
      `Using /hyperframes, add the "${title}" VFX (registry: ${name}) as a full-screen overlay on my composition.`,
      description,
      "This is a WebGL effect that requires chrome://flags/#html-in-canvas. Layer it on top of all content, adjust the shader uniforms and color palette to complement my scene, and set the duration to match the composition length.",
    ].join("\n\n"),
    transitions: [
      `Using /hyperframes, add the "${title}" transition (registry: ${name}) between my scenes.`,
      description,
      "Place this transition at the cut point between the current scene and the next. Set the duration to 0.5-1s, position it at the scene boundary on the timeline, and make sure the z-index is above both scenes. Adjust colors to match my palette.",
    ].join("\n\n"),
    effects: [
      `Using /hyperframes, add the "${title}" effect (registry: ${name}) as an overlay on my composition.`,
      description,
      "Layer this on top of the current content. Adjust the opacity, colors, and animation timing to enhance the scene without overwhelming the main content.",
    ].join("\n\n"),
    social: [
      `Using /hyperframes, add the "${title}" template (registry: ${name}) to my composition.`,
      description,
      "Replace the placeholder text, handle, and avatar with my actual content. Match the typography and colors to my brand. Adjust timing so the elements animate in sync with the voiceover.",
    ].join("\n\n"),
    data: [
      `Using /hyperframes, add the "${title}" visualization (registry: ${name}) to my composition.`,
      description,
      "Replace the placeholder data with my actual values and labels. Adjust the color scale, animation stagger timing, and typography to match my composition's design system. Size it to fit the current viewport.",
    ].join("\n\n"),
    scenes: [
      `Using /hyperframes, add the "${title}" scene (registry: ${name}) to my composition.`,
      description,
      "Replace all placeholder text, images, and content with my actual material. Match fonts, colors, and layout to my existing design tokens. Set the timeline position and duration to fit the narrative flow.",
    ].join("\n\n"),
  };

  const instruction =
    categoryPrompts[category] ??
    [
      `Using /hyperframes, add the "${title}" ${kind} (registry: ${name}) to my composition.`,
      description,
      "Customize it to match my composition's design and timeline.",
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
  locale,
}: {
  block: CatalogItem;
  visible: boolean;
  reducedMotion: boolean;
  registerCard: (name: string, element: HTMLElement | null) => void;
  previewController: PreviewController;
  onAddBlock?: (blockName: string, intent?: EffectInsertIntent) => Promise<boolean>;
  locale: "en" | "zh";
}) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoThumbnailFailed, setVideoThumbnailFailed] = useState(false);
  const [adding, setAdding] = useState(false);
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
    if (!visible || reducedMotion) return;
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
  }, [block.name, previewController, reducedMotion, visible]);

  const handleEnter = useCallback(() => {
    clearHoverTimer();
    if (!visible || reducedMotion) return;
    hoverTimerRef.current = setTimeout(startPreview, 60);
  }, [clearHoverTimer, reducedMotion, startPreview, visible]);

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
    if (adding || !onAddBlock) return;
    setAdding(true);
    const intent: EffectInsertIntent =
      block.librarySection === "opening-effect"
        ? "opening"
        : block.librarySection === "ending-effect"
          ? "ending"
          : "transition";
    void onAddBlock(block.name, intent).finally(() => {
      if (mountedRef.current) setAdding(false);
    });
  }, [adding, block.librarySection, block.name, onAddBlock]);

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
      const prompt = buildAgentPrompt(
        block.title,
        block.name,
        block.description,
        block.category,
        block.type,
        context,
      );
      window.parent.postMessage(
        {
          type: "ipollowork:hyperframes:animation-reference",
          animation: {
            name: block.name,
            title: block.title,
            description: block.description,
            type: block.type,
            category: block.category,
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
      tabIndex={0}
      className="group/card min-w-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20bbc0]/60"
      style={{ contentVisibility: "auto", containIntrinsicSize: "160px" }}
      data-testid="block-catalog-card"
      data-block-name={block.name}
      draggable
      onClick={handleAdd}
      onKeyDown={handleCardKeyDown}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(TIMELINE_BLOCK_MIME, JSON.stringify({ name: block.name }));
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
                {getCategoryLabel(block.category, locale)}
              </span>
            </div>
          </div>
        )}

        {previewing ? (
          !prefersCompositionPreview && videoUrl && !videoThumbnailFailed ? (
            <video
              src={videoUrl}
              aria-label={`${block.title} preview`}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              onCanPlay={() => setPreviewReady(true)}
              onError={() => setVideoThumbnailFailed(true)}
              className={`pointer-events-none absolute inset-0 z-[1] size-full object-cover transition-opacity duration-150 ${
                previewReady ? "opacity-100" : "opacity-0"
              }`}
            />
          ) : (
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
          )
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
            {getCategoryLabel(block.category, locale)}
          </span>
        </div>
        {block.engine?.plugins?.[0] ? (
          <div className="mt-0.5 truncate text-[8px] text-[#209b83]">{block.engine.plugins[0]}</div>
        ) : null}
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleAdd();
            }}
            title={
              locale === "zh"
                ? block.librarySection === "opening-effect"
                  ? "插入到视频开头并顺延现有内容"
                  : block.librarySection === "ending-effect"
                    ? "追加到视频末尾"
                    : "插入到选中片段与下一片段之间"
                : block.librarySection === "opening-effect"
                  ? "Insert at the start and shift existing content"
                  : block.librarySection === "ending-effect"
                    ? "Append to the end of the video"
                    : "Insert between the selected clip and the next clip"
            }
            className="flex h-7 min-w-0 items-center justify-center rounded-md border border-panel-border bg-panel-bg px-1 text-[9px] font-semibold text-panel-text-1 transition-colors hover:bg-panel-input"
          >
            <span className="truncate">
              {adding
                ? locale === "zh"
                  ? "插入中…"
                  : "Inserting…"
                : locale === "zh"
                  ? "插入片段"
                  : "Insert clip"}
            </span>
          </button>
          <button
            type="button"
            onClick={handleShowPrompt}
            title={
              locale === "zh"
                ? "\u8ba9 AI \u6309\u5f53\u524d\u573a\u666f\u96c6\u6210"
                : "Ask AI to integrate this effect"
            }
            className="flex h-7 min-w-0 items-center justify-center rounded-md bg-panel-input px-1 text-[9px] font-medium text-panel-text-1 transition-colors hover:bg-[#20bbc0]/12 hover:text-[#168e92]"
          >
            <span className="truncate">{locale === "zh" ? "\u4ea4\u7ed9 AI" : "Ask AI"}</span>
          </button>
        </div>
      </div>
    </div>
  );
});
