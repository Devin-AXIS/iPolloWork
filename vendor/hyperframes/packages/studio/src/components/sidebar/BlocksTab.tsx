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
import type { RegistryItemLibrarySection } from "@hyperframes/core/registry";
import {
  useBlockCatalog,
  type CatalogItem,
  type CatalogPage,
  type CatalogSection,
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

export interface BlockPreviewInfo {
  videoUrl?: string;
  posterUrl?: string;
  title: string;
}
interface BlocksTabProps {
  page?: CatalogPage;
  onAddBlock?: (blockName: string) => void;
  onPreviewBlock?: (preview: BlockPreviewInfo | null) => void;
}

const SECTION_TITLES: Record<RegistryItemLibrarySection, { en: string; zh: string }> = {
  "text-animation": { en: "Text animations", zh: "\u6587\u5b57\u52a8\u753b" },
  "interface-animation": { en: "Interface animations", zh: "\u754c\u9762\u52a8\u753b" },
  "transition-scene": { en: "Transition scenes", zh: "\u8f6c\u573a\u573a\u666f" },
  "background-scene": { en: "Background scenes", zh: "\u80cc\u666f\u573a\u666f" },
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const DEFAULT_CATALOG_COLUMN_COUNT: CatalogColumnCount = 3;
const PREVIEW_CLEAR_DELAY_MS = 140;
const CATALOG_GRID_COLUMNS: Record<CatalogColumnCount, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};
const ALL_SECTIONS_FILTER = "all" as const;
type CatalogSectionFilter = RegistryItemLibrarySection | typeof ALL_SECTIONS_FILTER;

function nextCatalogColumnCount(
  current: CatalogColumnCount,
  deltaY: number,
): CatalogColumnCount {
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

export const BlocksTab = memo(function BlocksTab({
  page = "animation",
  onAddBlock,
  onPreviewBlock,
}: BlocksTabProps) {
  const { locale } = useStudioI18n();
  const { loading, error, search, setSearch, sections } = useBlockCatalog(page);
  const [previewController] = useState(() => new PreviewController());
  const [activeSection, setActiveSection] = useState<CatalogSectionFilter>(ALL_SECTIONS_FILTER);
  const [columnCount, setColumnCount] = useState<CatalogColumnCount>(
    () => readStudioUiPreferences().catalogColumnCount ?? DEFAULT_CATALOG_COLUMN_COUNT,
  );
  const lastDensityWheelAtRef = useRef(Number.NEGATIVE_INFINITY);
  const previewClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  const emitPreviewBlock = useCallback(
    (preview: BlockPreviewInfo | null) => {
      if (previewClearTimerRef.current) {
        clearTimeout(previewClearTimerRef.current);
        previewClearTimerRef.current = null;
      }
      if (preview) {
        onPreviewBlock?.(preview);
        return;
      }
      previewClearTimerRef.current = setTimeout(() => {
        previewClearTimerRef.current = null;
        onPreviewBlock?.(null);
      }, PREVIEW_CLEAR_DELAY_MS);
    },
    [onPreviewBlock],
  );

  useEffect(
    () => () => {
      if (previewClearTimerRef.current) clearTimeout(previewClearTimerRef.current);
      previewController.dispose();
    },
    [previewController],
  );
  useEffect(() => {
    writeStudioUiPreferences({ catalogColumnCount: columnCount });
  }, [columnCount]);
  useEffect(() => {
    previewController.stop();
    if (previewClearTimerRef.current) {
      clearTimeout(previewClearTimerRef.current);
      previewClearTimerRef.current = null;
    }
    onPreviewBlock?.(null);
  }, [onPreviewBlock, page, previewController, reducedMotion, search]);

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
    () => activeSection === ALL_SECTIONS_FILTER
      ? sections
      : sections.filter((section) => section.id === activeSection),
    [activeSection, sections],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex-shrink-0 space-y-2 px-3 pb-2 pt-2">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              page === "animation"
                ? locale === "zh"
                  ? "搜索动画和场景"
                  : "Search animations and scenes"
                : locale === "zh"
                  ? "搜索场景"
                  : "Search animations and scenes"
            }
            aria-label={
              page === "animation"
                ? locale === "zh"
                  ? "搜索动画"
                  : "Search animations"
                : locale === "zh"
                  ? "搜索场景"
                  : "Search scenes"
            }
            data-testid="block-catalog-search"
            className="h-8 w-full rounded-lg border border-neutral-800 bg-neutral-950 pl-7 pr-2 text-[11px] text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/50"
          />
        </div>
        <div className="flex min-w-0 gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label={locale === "zh" ? "动画分类" : "Animation categories"}>
          <CatalogFilterChip
            label={locale === "zh" ? "全部" : "All"}
            count={totalCount}
            active={activeSection === ALL_SECTIONS_FILTER}
            onClick={() => setActiveSection(ALL_SECTIONS_FILTER)}
          />
          {sections.map((section) => (
            <CatalogFilterChip
              key={section.id}
              label={SECTION_TITLES[section.id][locale]}
              count={section.items.length}
              active={activeSection === section.id}
              onClick={() => setActiveSection(section.id)}
            />
          ))}
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
          onPreviewBlock={emitPreviewBlock}
          showSectionHeaders={activeSection === ALL_SECTIONS_FILTER}
          testId={`block-catalog-${page}`}
        />
      )}
    </div>
  );
});

function CatalogFilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-7 flex-shrink-0 items-center gap-1 rounded-full border px-2.5 text-[10px] font-medium transition-colors ${
        active
          ? "border-emerald-400/35 bg-emerald-400/12 text-emerald-200"
          : "border-neutral-800 bg-transparent text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "text-emerald-200/70" : "text-neutral-600"}>{count}</span>
    </button>
  );
}

function CatalogSectionGrid({
  sections,
  search,
  locale,
  reducedMotion,
  columnCount,
  onDensityWheel,
  previewController,
  onAddBlock,
  onPreviewBlock,
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
  onAddBlock?: (blockName: string) => void;
  onPreviewBlock?: (preview: BlockPreviewInfo | null) => void;
  showSectionHeaders: boolean;
  testId: string;
}) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [visibleNames, setVisibleNames] = useState<Set<string>>(() => new Set());
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
      { root: scrollRoot, threshold: 0.05 },
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
      className="hf-block-catalog-scroll min-h-0 min-w-0 flex-1 overscroll-contain px-3 pb-3"
      data-testid={testId}
      data-catalog-columns={columnCount}
      tabIndex={0}
      aria-label={locale === "zh" ? "\u52a8\u753b\u9884\u8bbe\u5217\u8868" : "Animation preset list"}
    >
      {itemCount === 0 ? (
        <div className="flex h-full min-h-16 items-center justify-center px-3 text-center text-[10px] text-neutral-600">
          {locale === "zh" ? "\u6ca1\u6709\u5339\u914d\u7684\u9884\u8bbe" : "No matching presets"}
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.id} data-testid={`catalog-section-${section.id}`}>
              {showSectionHeaders ? (
                <header className="mb-2 flex items-center justify-between">
                  <h2 className="truncate text-[11px] font-semibold text-neutral-300">{SECTION_TITLES[section.id][locale]}</h2>
                  <span className="text-[9px] tabular-nums text-neutral-600">{section.items.length}</span>
                </header>
              ) : null}
              <div
                className={`grid min-w-0 gap-1.5 overflow-x-hidden ${CATALOG_GRID_COLUMNS[columnCount]}`}
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
                    onPreview={onPreviewBlock}
                    locale={locale}
                    onAdd={() => onAddBlock?.(block.name)}
                  />
                ))}
              </div>
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


function BlockCard({
  block,
  visible,
  reducedMotion,
  registerCard,
  previewController,
  onAdd,
  onPreview,
  locale,
}: {
  block: CatalogItem;
  visible: boolean;
  reducedMotion: boolean;
  registerCard: (name: string, element: HTMLElement | null) => void;
  previewController: PreviewController;
  onAdd?: () => void;
  onPreview?: (preview: BlockPreviewInfo | null) => void;
  locale: "en" | "zh";
}) {
  const [thumbnailEnabled, setThumbnailEnabled] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const colors = getCategoryColors(block.category);
  const duration = block.type === "hyperframes:component" ? undefined : block.duration;
  const posterUrl = block.preview?.poster;
  const videoUrl = block.preview?.video;
  const canShowPoster = thumbnailEnabled && Boolean(posterUrl) && !posterFailed;
  const hasPreviewMedia = Boolean(videoUrl || posterUrl);
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
    if (!visible || reducedMotion || !videoUrl) return;
    previewController.start(block.name, async ({ isCurrent }) => {
      if (!isCurrent()) return undefined;
      onPreview?.({ videoUrl, posterUrl, title: block.title });

      return () => {
        onPreview?.(null);
      };
    });
  }, [
    block.name,
    block.title,
    onPreview,
    posterUrl,
    previewController,
    reducedMotion,
    videoUrl,
    visible,
  ]);

  const handleEnter = useCallback(() => {
    clearHoverTimer();
    if (!visible || reducedMotion || !videoUrl) return;
    hoverTimerRef.current = setTimeout(startPreview, 60);
  }, [clearHoverTimer, reducedMotion, startPreview, videoUrl, visible]);

  const handleLeave = useCallback(() => {
    clearHoverTimer();
    previewController.stop(block.name);
  }, [block.name, clearHoverTimer, previewController]);

  useEffect(() => {
    if (visible) {
      setThumbnailEnabled(true);
      return;
    }
    handleLeave();
  }, [handleLeave, visible]);

  useEffect(() => {
    setPosterFailed(false);
  }, [posterUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHoverTimer();
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      previewController.stop(block.name);
      registerCard(block.name, null);
    };
  }, [block.name, clearHoverTimer, previewController, registerCard]);

  const handleAdd = useCallback(() => {
    if (adding || !onAdd) return;
    setAdding(true);
    onAdd();
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setAdding(false);
    }, 1000);
  }, [adding, onAdd]);

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
      className="group/card min-w-0 cursor-pointer overflow-hidden rounded-md bg-neutral-900 transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
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
      <div className="relative aspect-video w-full overflow-hidden">
        {canShowPoster ? (
          <img
            src={posterUrl}
            alt=""
            loading="lazy"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center ${colors.bg}`}>
            <div className="flex min-w-0 flex-col items-center gap-1 px-2 text-center">
              <span className={`max-w-full truncate text-[7px] font-medium ${colors.text}`}>
                {getCategoryLabel(block.category, locale)}
              </span>
              {!hasPreviewMedia ? (
                <span className="rounded bg-white/60 px-1.5 py-0.5 text-[7px] font-medium text-neutral-600">
                  {locale === "zh" ? "\u6682\u65e0\u9884\u89c8" : "No preview yet"}
                </span>
              ) : null}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-1 top-1 flex items-center gap-0.5">
          {block.engine?.name.toLowerCase() === "gsap" ? (
            <span className="rounded bg-emerald-950/80 px-1 py-px text-[7px] font-semibold text-emerald-300">
              {block.source?.provider === "gsap-docs"
                ? "GSAP Official"
                : block.source?.provider === "gsap-demo-hub"
                  ? "Demo Hub"
                  : "GSAP"}
            </span>
          ) : null}
        </div>
        <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5">
          {needsWebGL ? (
            <span className="rounded bg-purple-900/70 px-1 py-px text-[7px] font-semibold text-purple-300">
              WebGL
            </span>
          ) : null}
          {duration != null ? (
            <span className="rounded bg-black/50 px-1 py-px text-[8px] font-medium text-white/80">
              {duration}s
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-1 py-1.5">
        <div className="truncate text-[9px] font-medium leading-tight text-neutral-200">
          {block.title}
        </div>
        {block.engine?.plugins?.[0] ? (
          <div className="mt-0.5 truncate text-[7px] text-emerald-400/80">
            {block.engine.plugins[0]}
          </div>
        ) : null}
        <div className="mt-1 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleAdd();
            }}
            title={locale === "zh" ? "\u5728\u5f53\u524d\u64ad\u653e\u5934\u4f4d\u7f6e\u6dfb\u52a0" : "Add at the current playhead"}
            className="flex h-6 min-w-0 items-center justify-center rounded bg-white px-1 text-[8px] font-semibold text-black transition-colors hover:bg-neutral-200"
          >
            <span className="truncate">
              {adding ? (locale === "zh" ? "\u5df2\u6dfb\u52a0" : "Added") : locale === "zh" ? "\u6dfb\u52a0" : "Add"}
            </span>
          </button>
          <button
            type="button"
            onClick={handleShowPrompt}
            title={locale === "zh" ? "\u8ba9 AI \u6309\u5f53\u524d\u573a\u666f\u96c6\u6210" : "Ask AI to integrate this effect"}
            className="flex h-6 min-w-0 items-center justify-center rounded bg-neutral-800 px-1 text-[8px] font-medium text-neutral-200 transition-colors hover:bg-neutral-700 hover:text-white"
          >
            <span className="truncate">{locale === "zh" ? "\u4ea4\u7ed9 AI" : "Ask AI"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
