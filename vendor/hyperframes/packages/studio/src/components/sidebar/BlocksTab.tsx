// fallow-ignore-file code-duplication
import { memo, useState, useCallback, useRef, useEffect } from "react";
import type {
  RegistryItemEngine,
  RegistryItemKind,
  RegistryItemSource,
} from "@hyperframes/core/registry";
import { useBlockCatalog } from "../../hooks/useBlockCatalog";
import {
  BLOCK_CATEGORIES,
  getCategoryColors,
  getCategoryLabel,
  type BlockCategory,
} from "../../utils/blockCategories";
import { usePlayerStore } from "../../player";
import { formatTime } from "../../player/lib/time";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { useStudioI18n } from "../../i18n";
export interface BlockPreviewInfo {
  videoUrl?: string;
  posterUrl?: string;
  title: string;
}

interface BlocksTabProps {
  kind?: RegistryItemKind;
  onAddBlock?: (blockName: string) => void;
  onPreviewBlock?: (preview: BlockPreviewInfo | null) => void;
}

// fallow-ignore-next-line complexity
export const BlocksTab = memo(function BlocksTab({
  kind = "animation",
  onAddBlock,
  onPreviewBlock,
}: BlocksTabProps) {
  const { locale } = useStudioI18n();
  const {
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
  } = useBlockCatalog(kind);
  const availableCategories = BLOCK_CATEGORIES.filter((candidate) =>
    kindBlocks.some((block) => block.category === candidate.id),
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-600 text-xs">
        Loading blocks…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-red-400 text-xs px-4 text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="mx-3 mt-2 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-[10px] leading-relaxed text-neutral-400">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-neutral-200">
            {kind === "animation"
              ? locale === "zh"
                ? "iPolloWork 动画预设"
                : "iPolloWork animation presets"
              : locale === "zh"
                ? "iPolloWork 特效预设"
                : "iPolloWork effect presets"}
          </span>
          <span className="font-semibold text-neutral-200">{kindBlocks.length}</span>
        </div>
        {kind === "effect" ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>{locale === "zh" ? "GSAP 3.15.0 官网能力" : "GSAP 3.15.0 official"}</span>
            <span>
              {locale === "zh" ? "插件" : "Plugins"} {coverage.plugins.covered}/
              {coverage.plugins.total}
              {" · "}
              {locale === "zh" ? "缓动" : "Eases"} {coverage.eases.covered}/{coverage.eases.total}
            </span>
          </div>
        ) : (
          <div className="mt-1">
            {locale === "zh"
              ? "悬停预览，将播放头移到目标时间后直接添加。"
              : "Hover to preview, then add at the current playhead."}
          </div>
        )}
      </div>
      {/* Search */}
      <div className="px-3 pt-2 pb-1 flex-shrink-0">
        <div className="relative">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              locale === "zh" ? "搜索名称、分类或标签..." : "Search by name, category, or tag..."
            }
            className="w-full bg-neutral-900 border border-neutral-800 rounded-md pl-7 pr-2 py-1.5 text-[11px] text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-700 transition-colors"
          />
        </div>
      </div>

      {/* Category pills */}
      <div className="px-3 pt-1 pb-2 flex-shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1">
          <CategoryPill
            label={locale === "zh" ? "全部" : "All"}
            active={category === null}
            onClick={() => setCategory(null)}
          />
          {availableCategories.map((cat) => (
            <CategoryPill
              key={cat.id}
              label={getCategoryLabel(cat.id, locale)}
              category={cat.id}
              active={category === cat.id}
              onClick={() => setCategory(category === cat.id ? null : cat.id)}
            />
          ))}
        </div>
      </div>
      {kind === "effect" && capabilities.length > 0 ? (
        <div className="flex flex-shrink-0 gap-1 overflow-x-auto px-3 pb-2">
          <button
            type="button"
            onClick={() => setCapability(null)}
            className={`h-6 flex-shrink-0 rounded-full border px-2 text-[9px] ${
              capability === null
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-neutral-800 bg-neutral-900 text-neutral-500"
            }`}
          >
            {locale === "zh" ? "全部官网能力" : "All official capabilities"}
          </button>
          {capabilities.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setCapability(capability === name ? null : name)}
              className={`h-6 flex-shrink-0 rounded-full border px-2 text-[9px] ${
                capability === name
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-neutral-800 bg-neutral-900 text-neutral-500"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {/* Block grid */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
        {category === "vfx" && (
          <div className="mb-2 px-2 py-1.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[9px] text-purple-300 leading-relaxed">
            VFX blocks use WebGL via HTML-in-Canvas. Enable{" "}
            <span className="font-mono text-purple-200">chrome://flags/#html-in-canvas</span> for
            preview.
          </div>
        )}
        {filteredBlocks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-neutral-600 text-xs">
            No blocks match your search
          </div>
        ) : (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
          >
            {filteredBlocks.map((block) => {
              const dur = block.type === "hyperframes:component" ? undefined : block.duration;
              return (
                <BlockCard
                  key={block.name}
                  name={block.name}
                  title={block.title}
                  description={block.description}
                  blockType={block.type}
                  duration={dur}
                  category={block.category}
                  tags={block.tags}
                  engine={block.engine}
                  source={block.source}
                  posterUrl={block.preview?.poster}
                  videoUrl={block.preview?.video}
                  onPreview={onPreviewBlock}
                  locale={locale}
                  onAdd={() => onAddBlock?.(block.name)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

function CategoryPill({
  label,
  category,
  active,
  onClick,
}: {
  label: string;
  category?: BlockCategory;
  active: boolean;
  onClick: () => void;
}) {
  const colors = category ? getCategoryColors(category) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${
        active
          ? colors
            ? `${colors.bg} ${colors.text}`
            : "bg-neutral-700 text-neutral-200"
          : "bg-neutral-900 text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {label}
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
    (el) => ctx.currentTime >= el.start && ctx.currentTime < el.start + el.duration,
  );
  if (visibleNow.length > 0) {
    lines.push(
      "",
      `Elements visible at ${formatTime(ctx.currentTime)}:`,
      ...visibleNow.map(
        (el) =>
          `- ${el.label || el.id} (track ${el.track}, ${formatTime(el.start)}–${formatTime(el.start + el.duration)}${el.compositionSrc ? `, src: ${el.compositionSrc}` : ""})`,
      ),
    );
  }
  const maxZ = ctx.elements.length > 0 ? Math.max(...ctx.elements.map((_, i) => i + 1)) : 0;
  lines.push("", `Highest track index: ${maxZ}`);
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
      `${description}`,
      `Transcribe the audio with /media-use, then wire the transcript into this caption component. Match the font colors and animation timing to my composition's design tokens. Place it as an overlay above the main content with the highest z-index.`,
    ].join("\n\n"),
    vfx: [
      `Using /hyperframes, add the "${title}" VFX (registry: ${name}) as a full-screen overlay on my composition.`,
      `${description}`,
      `This is a WebGL effect that requires chrome://flags/#html-in-canvas. Layer it on top of all content, adjust the shader uniforms and color palette to complement my scene, and set the duration to match the composition length.`,
    ].join("\n\n"),
    transitions: [
      `Using /hyperframes, add the "${title}" transition (registry: ${name}) between my scenes.`,
      `${description}`,
      `Place this transition at the cut point between the current scene and the next. Set the duration to 0.5–1s, position it at the scene boundary on the timeline, and make sure the z-index is above both scenes. Adjust colors to match my palette.`,
    ].join("\n\n"),
    effects: [
      `Using /hyperframes, add the "${title}" effect (registry: ${name}) as an overlay on my composition.`,
      `${description}`,
      `Layer this on top of the current content. Adjust the opacity, colors, and animation timing to enhance the scene without overwhelming the main content.`,
    ].join("\n\n"),
    social: [
      `Using /hyperframes, add the "${title}" template (registry: ${name}) to my composition.`,
      `${description}`,
      `Replace the placeholder text, handle, and avatar with my actual content. Match the typography and colors to my brand. Adjust timing so the elements animate in sync with the voiceover.`,
    ].join("\n\n"),
    data: [
      `Using /hyperframes, add the "${title}" visualization (registry: ${name}) to my composition.`,
      `${description}`,
      `Replace the placeholder data with my actual values and labels. Adjust the color scale, animation stagger timing, and typography to match my composition's design system. Size it to fit the current viewport.`,
    ].join("\n\n"),
    scenes: [
      `Using /hyperframes, add the "${title}" scene (registry: ${name}) to my composition.`,
      `${description}`,
      `Replace all placeholder text, images, and content with my actual material. Match fonts, colors, and layout to my existing design tokens. Set the timeline position and duration to fit the narrative flow.`,
    ].join("\n\n"),
  };

  const instruction =
    categoryPrompts[category] ??
    [
      `Using /hyperframes, add the "${title}" ${kind} (registry: ${name}) to my composition.`,
      `${description}`,
      `Customize it to match my composition's design and timeline.`,
    ].join("\n\n");

  return [instruction, "", "## Current composition state", "", compositionInfo].join("\n");
}

function BlockCard({
  name,
  title,
  description,
  blockType,
  duration,
  category,
  tags,
  engine,
  source,
  posterUrl,
  videoUrl,
  onAdd,
  onPreview,
  locale,
}: {
  name: string;
  title: string;
  description: string;
  blockType: string;
  duration?: number;
  category: BlockCategory;
  tags?: string[];
  engine?: RegistryItemEngine;
  source?: RegistryItemSource;
  posterUrl?: string;
  videoUrl?: string;
  onAdd?: () => void;
  onPreview?: (preview: BlockPreviewInfo | null) => void;
  locale: "en" | "zh";
}) {
  const [hovered, setHovered] = useState(false);
  const [adding, setAdding] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = getCategoryColors(category);
  const needsWebGL = tags?.includes("html-in-canvas") || tags?.includes("webgl");
  const canShowPoster = Boolean(posterUrl) && !posterFailed;
  const canShowVideo = Boolean(videoUrl) && !videoFailed;

  useEffect(() => setPosterFailed(false), [posterUrl]);
  useEffect(() => setVideoFailed(false), [videoUrl]);

  const handleEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => {
      setHovered(true);
      onPreview?.({ videoUrl, posterUrl, title });
    }, 300);
  }, [onPreview, videoUrl, posterUrl, title]);

  const handleLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(false);
    onPreview?.(null);
  }, [onPreview]);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (adding || !onAdd) return;
      setAdding(true);
      onAdd();
      setTimeout(() => setAdding(false), 1000);
    },
    [onAdd, adding],
  );

  const { activeCompPath, compositionDimensions } = useStudioShellContext();

  const handleShowPrompt = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const state = usePlayerStore.getState();
      const context: CompositionContext = {
        currentTime: state.currentTime,
        activeCompPath,
        elements: state.elements.map((el) => ({
          id: el.id,
          start: el.start,
          duration: el.duration,
          track: el.track,
          label: el.label,
          compositionSrc: el.compositionSrc,
        })),
        compositionDimensions: compositionDimensions ?? undefined,
      };
      const prompt = buildAgentPrompt(title, name, description, category, blockType, context);
      window.parent.postMessage(
        {
          type: "ipollowork:hyperframes:animation-reference",
          animation: {
            name,
            title,
            description,
            type: blockType,
            category,
            tags: tags ?? [],
            duration,
            preview: { poster: posterUrl, video: videoUrl },
            agentPrompt: prompt,
          },
        },
        "*",
      );
    },
    [
      title,
      name,
      description,
      category,
      blockType,
      activeCompPath,
      compositionDimensions,
      tags,
      duration,
      posterUrl,
      videoUrl,
    ],
  );

  return (
    <div
      className="group/card rounded-md overflow-hidden cursor-pointer transition-colors bg-neutral-900 hover:bg-neutral-800"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(TIMELINE_BLOCK_MIME, JSON.stringify({ name }));
        e.dataTransfer.setData("text/plain", name);
        handleLeave(); // cancel the hover-preview timer so it doesn't fire mid-drag
      }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      <div className="relative aspect-video w-full overflow-hidden">
        {canShowVideo && (hovered || !canShowPoster) ? (
          <video
            src={videoUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setVideoFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : canShowPoster ? (
          <img
            src={posterUrl}
            alt=""
            loading="lazy"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center ${colors.bg}`}>
            <span className={`text-[9px] font-medium ${colors.text}`}>
              {getCategoryLabel(category, locale)}
            </span>
          </div>
        )}

        {/* Badges */}
        <div className="absolute left-1 top-1 flex items-center gap-0.5 pointer-events-none">
          {engine?.name.toLowerCase() === "gsap" ? (
            <span className="rounded bg-emerald-950/80 px-1 py-px text-[7px] font-semibold text-emerald-300">
              {source?.provider === "gsap-docs"
                ? "GSAP Official"
                : source?.provider === "gsap-demo-hub"
                  ? "Demo Hub"
                  : "GSAP"}
            </span>
          ) : null}
        </div>
        <div className="absolute top-1 right-1 flex items-center gap-0.5 pointer-events-none">
          {needsWebGL && (
            <span className="px-1 py-px rounded text-[7px] font-semibold text-purple-300 bg-purple-900/70">
              WebGL
            </span>
          )}
          {duration != null && (
            <span className="px-1 py-px rounded text-[8px] font-medium text-white/80 bg-black/50">
              {duration}s
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="px-1.5 py-1.5">
        <div className="text-[10px] font-medium text-neutral-200 truncate leading-tight">
          {title}
        </div>
        {engine?.plugins?.[0] ? (
          <div className="mt-0.5 truncate text-[8px] text-emerald-400/80">{engine.plugins[0]}</div>
        ) : null}
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={handleAdd}
            title={locale === "zh" ? "在当前播放头位置添加" : "Add at the current playhead"}
            className="flex h-7 min-w-0 items-center justify-center gap-1 rounded-md bg-white px-1.5 text-[9px] font-semibold text-black transition-colors hover:bg-neutral-200"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="truncate">
              {adding ? (locale === "zh" ? "已添加" : "Added") : locale === "zh" ? "添加" : "Add"}
            </span>
          </button>
          <button
            type="button"
            onClick={handleShowPrompt}
            title={locale === "zh" ? "让 AI 按当前场景集成" : "Ask AI to integrate this effect"}
            className="flex h-7 min-w-0 items-center justify-center gap-1 rounded-md bg-neutral-800 px-1.5 text-[9px] font-medium text-neutral-200 transition-colors hover:bg-neutral-700 hover:text-white"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span className="truncate">{locale === "zh" ? "交给 AI" : "Ask AI"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
