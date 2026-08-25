"use client";

import { type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";
import { createPortal } from "react-dom";
import { LazyMotion, domAnimation, m, useReducedMotion, type Transition } from "motion/react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  AppWindow,
  Brain,
  FileChartColumnIncreasing,
  FileText,
  Film,
  FolderOpen,
  Globe2,
  Image,
  LoaderCircle,
  Bug,
  Code2,
  MonitorCog,
  PanelsTopLeft,
  Presentation,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { isPptxCompatibleTemplate, type TemplateCatalogItem } from "@ipollowork/types/templates";
import type {
  HyperframesAnimationSelection,
  HyperframesCatalogItem,
  HyperframesEffectVariable,
  HyperframesEffectVariableValue,
  HyperframesEffectVariableValues,
} from "@/app/lib/ipollowork-server";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveHyperframesEffectVariableValues } from "@ipollowork/types/hyperframes";
import {
  hyperframesSelectionUpdateMode,
  updateHyperframesEffectVariableOverride,
} from "@/app/lib/hyperframes-effect-params";
import { publicAssetUrl } from "@/app/lib/public-asset";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type NewConversationMode = "work" | "code" | "design" | "video";

type Icon = LucideIcon;
export type TemplateCoverLoader = (templateId: string) => Promise<{ data: ArrayBuffer; contentType?: string | null }>;

type NewConversationStarterProps = {
  selectedMode: NewConversationMode;
  selectedCapabilityId?: string | null;
  onSelectMode: (mode: NewConversationMode) => void;
  onSelectPrompt: (prompt: string, capability?: StarterCapability) => void;
  templates?: TemplateCatalogItem[];
  templatesLoading?: boolean;
  templateBusyId?: string | null;
  getTemplateCover?: TemplateCoverLoader;
  onUseTemplate?: (templateId: string, surface: "design" | "video") => void;
  onInstallTemplate?: (templateId: string) => void;
  onRequestTemplates?: () => void;
  animationCatalog?: HyperframesCatalogItem[];
  animationCatalogLoading?: boolean;
  animationCatalogError?: string | null;
  selectedAnimations?: HyperframesAnimationSelection[];
  onToggleAnimation?: (animation: HyperframesCatalogItem) => void;
  onChangeAnimationParams?: (animation: HyperframesCatalogItem, values: HyperframesEffectVariableValues) => void;
  onRetryAnimationCatalog?: () => void;
};

const VIDEO_TEMPLATE_PICKER_ENABLED = true;
const VIDEO_ANIMATION_PICKER_ENABLED = false;
const RECENT_ANIMATION_STORAGE_KEY = "ipollowork.video.recent-animations.v1";
const RECENT_ANIMATION_LIMIT = 6;
const HYPERFRAMES_LIBRARY_KINDS: ReadonlyArray<"animation" | "effect"> = ["animation", "effect"];
const ANIMATION_CATEGORY_ORDER = ["scenes", "data", "code-animation", "social", "scroll", "svg", "text-effects", "transitions", "captions", "effects", "vfx"];
const ANIMATION_CATEGORY_LABELS: Record<string, { en: string; zh: string }> = {
  scenes: { en: "Scenes", zh: "场景" },
  data: { en: "Data", zh: "数据动画" },
  "code-animation": { en: "Code", zh: "代码动画" },
  social: { en: "Social", zh: "社交元素" },
  scroll: { en: "Scroll", zh: "滚动特效" },
  svg: { en: "SVG", zh: "SVG 特效" },
  "text-effects": { en: "Text", zh: "文字特效" },
  transitions: { en: "Transitions", zh: "转场" },
  captions: { en: "Captions", zh: "动态字幕" },
  effects: { en: "Effects", zh: "画面效果" },
  vfx: { en: "VFX", zh: "视觉特效" },
};

const MODES = [
  { id: "work", iconSrc: publicAssetUrl("new-conversation-tabs/work.svg"), label: "new_conversation.mode.work" },
  { id: "code", iconSrc: publicAssetUrl("new-conversation-tabs/code.svg"), label: "new_conversation.mode.code" },
  { id: "design", iconSrc: publicAssetUrl("new-conversation-tabs/design.svg"), label: "new_conversation.mode.design" },
  { id: "video", iconSrc: publicAssetUrl("new-conversation-tabs/video.svg"), label: "new_conversation.mode.video" },
] as const satisfies ReadonlyArray<{ id: NewConversationMode; iconSrc: string; label: string }>;

const QUICK_TASK_GLOBE_ASSET = publicAssetUrl("quick-task-globe.svg");
const QUICK_TASK_GLOBE_SELECTED_ASSET = publicAssetUrl("quick-task-globe-selected.svg");
const QUICK_TASK_PLUS_ASSET = publicAssetUrl("quick-task-plus.svg");

const MODE_TAB_SPRING = {
  type: "spring",
  mass: 1,
  stiffness: 300,
  damping: 20,
} satisfies Transition;

type StarterAction = {
  id: string;
  label: string;
  icon: Icon;
  prompt?: string;
  templateCategory?: TemplateCategory;
};

export type StarterCapability = {
  id: string;
  label: string;
  icon: Icon;
  instruction: string;
};

type TemplateCategory = "site" | "poster" | "cards" | "app" | "article" | "slides" | "report" | "other" | "video";

const TEMPLATE_CATEGORY_ICONS: Record<TemplateCategory, Icon> = {
  site: Globe2,
  poster: Image,
  cards: PanelsTopLeft,
  app: AppWindow,
  article: FileText,
  slides: Presentation,
  report: FileChartColumnIncreasing,
  other: FolderOpen,
  video: Film,
};

const MODE_ACTIONS: Record<NewConversationMode, ReadonlyArray<StarterAction>> = {
  work: [
    { id: "auto_computer", label: "new_conversation.action.auto_computer", icon: MonitorCog, prompt: "new_conversation.prompt.auto_computer" },
    { id: "document", label: "new_conversation.action.document", icon: FileText, prompt: "new_conversation.prompt.document" },
    { id: "data", label: "new_conversation.action.data", icon: Table2, prompt: "new_conversation.prompt.data" },
    { id: "deep_research", label: "new_conversation.action.deep_research", icon: Brain, prompt: "new_conversation.prompt.deep_research" },
    { id: "browser", label: "new_conversation.action.browser", icon: Globe2, prompt: "new_conversation.prompt.browser" },
  ],
  code: [
    { id: "understand_code", label: "new_conversation.action.understand_code", icon: Code2, prompt: "new_conversation.prompt.understand_code" },
    { id: "build_feature", label: "new_conversation.action.build_feature", icon: Wrench, prompt: "new_conversation.prompt.build_feature" },
    { id: "debug", label: "new_conversation.action.debug", icon: Bug, prompt: "new_conversation.prompt.debug" },
  ],
  design: [
    { id: "site", label: "new_conversation.action.website", icon: TEMPLATE_CATEGORY_ICONS.site, templateCategory: "site" },
    { id: "slides", label: "new_conversation.action.presentation", icon: TEMPLATE_CATEGORY_ICONS.slides, templateCategory: "slides" },
    { id: "cards", label: "new_conversation.action.info_card", icon: TEMPLATE_CATEGORY_ICONS.cards, templateCategory: "cards" },
    { id: "poster", label: "new_conversation.action.poster", icon: TEMPLATE_CATEGORY_ICONS.poster, templateCategory: "poster" },
    { id: "app", label: "new_conversation.action.app", icon: TEMPLATE_CATEGORY_ICONS.app, templateCategory: "app" },
    { id: "article", label: "new_conversation.action.article", icon: TEMPLATE_CATEGORY_ICONS.article, templateCategory: "article" },
    { id: "report", label: "new_conversation.action.report", icon: TEMPLATE_CATEGORY_ICONS.report, templateCategory: "report" },
    { id: "other", label: "new_conversation.action.other", icon: TEMPLATE_CATEGORY_ICONS.other, templateCategory: "other" },
  ],
  video: [],
};

const DEFAULT_SHORTCUT_IDS: Record<NewConversationMode, string[]> = {
  work: ["auto_computer", "document", "data", "deep_research", "browser"],
  code: ["understand_code", "build_feature", "debug"],
  design: ["site", "slides", "cards", "poster"],
  video: [],
};

const SHORTCUT_STORAGE_KEY = "ipollowork.new-conversation-shortcuts.v5";

function TemplateThumbnail({ template, getTemplateCover }: { template: TemplateCatalogItem; getTemplateCover?: TemplateCoverLoader }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!getTemplateCover) return;
    let active = true;
    let objectUrl = "";
    setSrc(null);
    void getTemplateCover(template.manifest.id).then(({ data, contentType }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([data], { type: contentType ?? "image/svg+xml" }));
      setSrc(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [getTemplateCover, template.installedVersion, template.manifest.id, template.manifest.version]);

  return src ? (
    <img src={src} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="h-full w-full bg-[linear-gradient(135deg,hsl(var(--primary)/0.18),hsl(var(--muted))_54%,hsl(var(--background)))]" />
  );
}

function TemplateStrip({
  templates,
  loading,
  busyId,
  category,
  getTemplateCover,
  onUseTemplate,
  onInstallTemplate,
  onRequestTemplates,
}: {
  templates: TemplateCatalogItem[];
  loading: boolean;
  busyId?: string | null;
  category: TemplateCategory;
  getTemplateCover?: TemplateCoverLoader;
  onUseTemplate?: (templateId: string, surface: "design" | "video") => void;
  onInstallTemplate?: (templateId: string) => void;
  onRequestTemplates?: () => void;
}) {
  const categoryTemplates = templates.filter((template) => (
    template.manifest.category === category && (category !== "video" || template.manifest.surface === "video")
  ));
  const categoryLabel = t(`new_conversation.template_category.${category}`);
  const CategoryIcon = TEMPLATE_CATEGORY_ICONS[category];
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const updateScrollState = () => {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      setScrollable(maxScroll > 1);
      setScrollProgress(maxScroll > 0 ? Math.round((scroller.scrollLeft / maxScroll) * 100) : 0);
    };

    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(scroller);
    scroller.addEventListener("scroll", updateScrollState, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", updateScrollState);
    };
  }, [categoryTemplates.length, loading]);

  const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const nextProgress = Number(event.currentTarget.value);
    scroller.scrollLeft = maxScroll * (nextProgress / 100);
    setScrollProgress(nextProgress);
  };

  return (
    <section data-testid="new-conversation-template-strip" data-category={category} className="mt-4 min-h-[185px] rounded-xl border border-border/80 bg-muted/25 p-3" aria-live="polite">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-0.5">
        <div>
          <p className="text-[13px] font-medium text-foreground">{t("new_conversation.templates.title", { category: categoryLabel })}</p>
        </div>
        <CategoryIcon className="size-4 shrink-0 text-primary/70" aria-hidden />
      </div>

      {loading ? (
        <div className="flex h-[106px] items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/55" aria-label={t("new_conversation.templates.loading")}>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            </span>
            <span>{t("new_conversation.templates.loading")}</span>
          </div>
        </div>
      ) : categoryTemplates.length ? (
        <div>
          <div ref={scrollerRef} className="-mx-0.5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categoryTemplates.map((template) => {
              const busy = busyId === template.manifest.id;
              const canUse = template.installed && Boolean(onUseTemplate);
              const label = template.installed ? t("new_conversation.templates.use") : t("new_conversation.templates.install");
              return (
                <button
                  key={template.manifest.id}
                  type="button"
                  disabled={busy || (!canUse && !onInstallTemplate)}
                  aria-label={`${label}: ${template.manifest.title}`}
                  data-busy={busy ? "true" : undefined}
                  className="group relative h-[106px] min-w-[172px] snap-start overflow-hidden rounded-lg border border-border/80 bg-background text-left shadow-sm transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:shadow-md disabled:cursor-not-allowed disabled:opacity-55 data-[busy=true]:shadow-md"
                  onClick={() => {
                    if (template.installed) onUseTemplate?.(template.manifest.id, template.manifest.surface);
                    else onInstallTemplate?.(template.manifest.id);
                  }}
                >
                  <TemplateThumbnail template={template} getTemplateCover={getTemplateCover} />
                  {isPptxCompatibleTemplate(template.manifest) ? <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground shadow-sm">{t("template_market.pptx_compatible")}</span> : null}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100 group-data-[busy=true]:opacity-100"
                  >
                    <span className="flex h-6 items-center rounded-md bg-white px-2 py-0.5 text-[12px] font-medium leading-none text-black shadow-sm">
                      {busy ? "…" : label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {scrollable ? (
            <input
              type="range"
              min="0"
              max="100"
              value={scrollProgress}
              aria-label={t("new_conversation.templates.loading")}
              className="template-preview-slider mt-2 block w-full"
              onChange={handleSliderChange}
            />
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
          <p className="text-[12px] text-muted-foreground">
            {t("new_conversation.templates.empty", { category: categoryLabel })}
          </p>
          {category === "video" ? (
            <div className="mt-3 space-y-2">
              <p className="mx-auto max-w-[26rem] text-[11px] leading-4 text-muted-foreground">
                {t("new_conversation.templates.video_empty_hint")}
              </p>
              {onRequestTemplates ? (
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={onRequestTemplates}
                >
                  {t("new_conversation.templates.retry")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
function AnimationCatalogCard({
  item,
  active,
  configuredCount,
  recent,
  locale,
  onToggle,
  onConfigure,
}: {
  item: HyperframesCatalogItem;
  active: boolean;
  configuredCount: number;
  recent: boolean;
  locale: "en" | "zh";
  onToggle?: (animation: HyperframesCatalogItem) => void;
  onConfigure?: (animation: HyperframesCatalogItem) => void;
}) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const [previewing, setPreviewing] = useState(false);
  const previewVideo = item.preview?.video;
  const categoryLabel = ANIMATION_CATEGORY_LABELS[item.category]?.[locale] ?? item.category;

  useEffect(() => {
    if (!previewing) return;
    const preview = previewRef.current;
    if (!preview) return;
    preview.currentTime = 0;
    void preview.play().catch(() => undefined);
  }, [previewing]);

  const updatePreview = () => {
    const shouldPreview = Boolean(previewVideo) && (hoveredRef.current || focusedRef.current);
    if (!shouldPreview) {
      const preview = previewRef.current;
      if (preview) {
        preview.pause();
        preview.currentTime = 0;
      }
    }
    setPreviewing(shouldPreview);
  };

  return (
    <div className={cn("group w-[154px] shrink-0 snap-start overflow-hidden rounded-lg border bg-background text-left transition", active ? "border-primary ring-2 ring-primary/20" : "border-border/80 hover:border-primary/45")}>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onToggle?.(item)}
        onMouseEnter={() => {
          hoveredRef.current = true;
          updatePreview();
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          updatePreview();
        }}
        onFocus={() => {
          focusedRef.current = true;
          updatePreview();
        }}
        onBlur={() => {
          focusedRef.current = false;
          updatePreview();
        }}
        className="block w-full text-left"
      >
        <div className="relative aspect-video overflow-hidden bg-muted">
          {previewing && previewVideo ? (
            <video
              ref={previewRef}
              src={previewVideo}
              poster={item.preview?.poster}
              muted
              loop
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : item.preview?.poster ? (
            <img src={item.preview.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{ANIMATION_CATEGORY_LABELS[item.category]?.[locale] ?? item.category}</div>
          )}
          <span className={cn("absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm", active ? "border-primary bg-primary text-primary-foreground" : "border-white/70 bg-black/45 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>
            {active ? <CheckIcon className="size-3" /> : <Plus className="size-3" />}
          </span>
          <span className="absolute left-1.5 top-1.5 max-w-[125px] truncate rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
            {item.engine ? `${item.engine.name.toUpperCase()} · ${categoryLabel}` : categoryLabel}
          </span>
          {recent ? <span className="absolute left-1 bottom-1 rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-medium text-foreground shadow-sm">{t("new_conversation.animations.recent")}</span> : null}
          {item.duration ? <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 text-[9px] text-white">{item.duration}s</span> : null}
        </div>
        <div className="px-2 py-1.5">
          <div className="truncate text-[11px] font-medium text-foreground">{item.title}</div>
          <div className="mt-0.5 flex items-center justify-between gap-1 text-[9px] text-muted-foreground">
            <span className="truncate">{item.engine?.plugins?.[0] ?? "GSAP Core"}</span>
            <span className="shrink-0 text-emerald-600">{t("new_conversation.animations.bundled")}</span>
          </div>
        </div>
      </button>
      {item.variables.length ? (
        <button
          type="button"
          className="flex h-7 w-full items-center justify-center gap-1 border-t border-border/70 px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onConfigure?.(item)}
        >
          <SlidersHorizontal className="size-3" />
          {configuredCount
            ? t("new_conversation.animations.customized", { count: configuredCount })
            : t("new_conversation.animations.configure")}
        </button>
      ) : null}
    </div>
  );
}

function AnimationVariableControl({
  variable,
  value,
  onChange,
}: {
  variable: HyperframesEffectVariable;
  value: HyperframesEffectVariableValue;
  onChange: (value: HyperframesEffectVariableValue) => void;
}) {
  const inputId = `hyperframes-variable-${variable.id}`;
  return (
    <div className="space-y-1.5 rounded-lg border border-border/70 bg-background/65 p-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-[12px] font-medium text-foreground">{variable.label}</label>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase", variable.update === "live" ? "bg-emerald-500/10 text-emerald-600" : variable.update === "rebuild" ? "bg-amber-500/10 text-amber-600" : "bg-sky-500/10 text-sky-600")}>
          {variable.update}
        </span>
      </div>
      {variable.description ? <p className="text-[10px] text-muted-foreground">{variable.description}</p> : null}
      {variable.type === "color" ? (
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="color"
            value={typeof value === "string" ? value : variable.default}
            aria-label={variable.label}
            className="size-9 cursor-pointer rounded-md border border-border bg-transparent p-1"
            onChange={(event) => onChange(event.target.value)}
          />
          <code className="text-[11px] text-muted-foreground">{value}</code>
        </div>
      ) : null}
      {variable.type === "number" ? (
        <div className="flex items-center gap-3">
          <input
            id={inputId}
            type="range"
            min={variable.min}
            max={variable.max}
            step={variable.step}
            value={typeof value === "number" ? value : variable.default}
            aria-label={variable.label}
            className="min-w-0 flex-1 accent-primary"
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <output htmlFor={inputId} className="w-14 text-right text-[11px] tabular-nums text-foreground">
            {value}{variable.unit ?? ""}
          </output>
        </div>
      ) : null}
      {variable.type === "enum" ? (
        <Select
          value={typeof value === "string" ? value : variable.default}
          onValueChange={(nextValue) => {
            if (nextValue) onChange(nextValue);
          }}
        >
          <SelectTrigger id={inputId} aria-label={variable.label} className="w-full text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {variable.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
      {variable.type === "string" ? (
        <input
          id={inputId}
          type="text"
          value={typeof value === "string" ? value : variable.default}
          maxLength={variable.maxLength}
          aria-label={variable.label}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      {variable.type === "boolean" ? (
        <input
          id={inputId}
          type="checkbox"
          checked={typeof value === "boolean" ? value : variable.default}
          aria-label={variable.label}
          className="size-4 accent-primary"
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : null}
    </div>
  );
}

function AnimationParameterDialog({
  item,
  values,
  onChange,
  onClose,
}: {
  item: HyperframesCatalogItem | null;
  values: HyperframesEffectVariableValues;
  onChange: (values: HyperframesEffectVariableValues) => void;
  onClose: () => void;
}) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const preservedTimeRef = useRef(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<"live" | "rebuild" | "reload" | null>(null);
  const resolvedValues = useMemo(
    () => item ? resolveHyperframesEffectVariableValues(item, values) : {},
    [item, values],
  );
  const backgroundColor = typeof resolvedValues.backgroundColor === "string" ? resolvedValues.backgroundColor : "#09090b";
  const textColor = typeof resolvedValues.textColor === "string" ? resolvedValues.textColor : "#ffffff";
  const waveIntensity = typeof resolvedValues.waveIntensity === "number" ? resolvedValues.waveIntensity : 1;
  const animationSpeed = typeof resolvedValues.animationSpeed === "number" ? resolvedValues.animationSpeed : 1;

  useEffect(() => {
    if (previewRef.current) previewRef.current.playbackRate = animationSpeed;
  }, [animationSpeed, previewRevision]);

  const handleVariableChange = (variable: HyperframesEffectVariable, value: HyperframesEffectVariableValue) => {
    if (!item) return;
    const update = hyperframesSelectionUpdateMode(item, variable.id);
    if (update !== "live") {
      preservedTimeRef.current = previewRef.current?.currentTime ?? preservedTimeRef.current;
      setPreviewRevision((current) => current + 1);
    }
    setLastUpdate(update);
    onChange(updateHyperframesEffectVariableOverride(item, values, variable.id, value));
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[980px] gap-4">
        <DialogHeader>
          <DialogTitle>{item ? t("new_conversation.animations.parameters_title", { title: item.title }) : ""}</DialogTitle>
          <DialogDescription>{t("new_conversation.animations.parameters_description")}</DialogDescription>
          {item ? (
            <div className="flex flex-wrap gap-1.5 pt-1 text-[10px] text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-1">{item.source?.label ?? "HyperFrames"}</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700">
                {item.engine ? `${item.engine.name.toUpperCase()} ${item.engine.version ?? ""}` : item.category}
              </span>
              {(item.engine?.plugins ?? ["GSAP Core"]).map((pluginName) => (
                <span key={pluginName} className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-700">{pluginName}</span>
              ))}
              <span className="rounded-full bg-sky-500/10 px-2 py-1 text-sky-700">{t("new_conversation.animations.bundled")}</span>
            </div>
          ) : null}
        </DialogHeader>
        {item ? (
          <div className="grid min-h-0 grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] gap-4 max-[860px]:grid-cols-1">
            <div className="space-y-2">
              <div
                className="relative aspect-video overflow-hidden rounded-xl border border-border"
                style={{ backgroundColor }}
              >
                {item.preview?.video ? (
                  <video
                    key={previewRevision}
                    ref={previewRef}
                    src={item.preview.video}
                    poster={item.preview.poster}
                    muted
                    loop
                    autoPlay
                    playsInline
                    className="h-full w-full object-cover transition-[filter,transform] duration-150"
                    style={{
                      filter: `saturate(${Math.max(0.4, waveIntensity)}) contrast(${1 + waveIntensity * 0.04})`,
                      transform: `scale(${1 + waveIntensity * 0.005})`,
                    }}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.currentTime = Math.min(preservedTimeRef.current, event.currentTarget.duration || preservedTimeRef.current);
                      event.currentTarget.playbackRate = animationSpeed;
                    }}
                  />
                ) : item.preview?.poster ? (
                  <img src={item.preview.poster} alt="" className="h-full w-full object-cover" />
                ) : null}
                <div
                  className="pointer-events-none absolute inset-0 transition-colors duration-150"
                  style={{ backgroundColor, mixBlendMode: "color", opacity: 0.65 }}
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 text-[10px]" style={{ color: textColor }}>
                  <span>{t("new_conversation.animations.live_preview")}</span>
                  <span>{item.engine ? `${item.engine.name.toUpperCase()} ${item.engine.version ?? ""}` : item.category}</span>
                </div>
              </div>
              <div className="flex min-h-7 items-center justify-between rounded-lg bg-muted/60 px-2.5 text-[10px] text-muted-foreground">
                <span>{lastUpdate ? t(`new_conversation.animations.update_${lastUpdate}`) : t("new_conversation.animations.preview_defaults")}</span>
                <span>{t("new_conversation.animations.current_time", { time: preservedTimeRef.current.toFixed(1) })}</span>
              </div>
            </div>
            <div className="grid max-h-[390px] grid-cols-2 gap-2 overflow-y-auto pr-1 max-[860px]:grid-cols-1">
              {item.variables.map((variable) => (
                <AnimationVariableControl
                  key={variable.id}
                  variable={variable}
                  value={resolvedValues[variable.id] ?? variable.default}
                  onChange={(value) => handleVariableChange(variable, value)}
                />
              ))}
            </div>
          </div>
        ) : null}
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onChange({})}>
            <RotateCcw className="size-3.5" />
            {t("common.reset")}
          </button>
          <button type="button" className="h-8 rounded-lg bg-foreground px-4 text-[11px] font-medium text-background" onClick={onClose}>
            {t("common.close")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnimationCatalogStrip({
  items,
  loading,
  error,
  selected,
  onToggle,
  onChangeAnimationParams,
  onRetry,
}: {
  items: HyperframesCatalogItem[];
  loading: boolean;
  error?: string | null;
  selected: HyperframesAnimationSelection[];
  onToggle?: (animation: HyperframesCatalogItem) => void;
  onChangeAnimationParams?: (animation: HyperframesCatalogItem, values: HyperframesEffectVariableValues) => void;
  onRetry?: () => void;
}) {
  const [libraryKind, setLibraryKind] = useState<"animation" | "effect">("effect");
  const [category, setCategory] = useState<string | null>(null);
  const [plugin, setPlugin] = useState<string | null>(null);
  const [recentAnimationNames, setRecentAnimationNames] = useState<string[]>([]);
  const [editingItem, setEditingItem] = useState<HyperframesCatalogItem | null>(null);
  const selectedByName = new Map(selected.map((selection) => [selection.item.name, selection]));
  const selectedNames = new Set(selectedByName.keys());
  const locale = typeof document !== "undefined" && document.documentElement.lang === "zh" ? "zh" : "en";
  const recentNameSet = new Set(recentAnimationNames);
  const gsapItems = items.filter((item) => item.engine?.name.toLowerCase() === "gsap");
  const kindItems = gsapItems.filter((item) => item.kind === libraryKind);
  const animationCount = gsapItems.filter((item) => item.kind === "animation").length;
  const effectCount = gsapItems.filter((item) => item.kind === "effect").length;
  const pluginName = (item: HyperframesCatalogItem) => item.engine?.plugins?.[0] ?? "GSAP Core";
  const plugins = Array.from(new Set(kindItems.map(pluginName)));
  const filtered = [...kindItems.filter((item) => (
    (!category || item.category === category)
    && (!plugin || pluginName(item) === plugin)
  ))].sort((left, right) => {
    const leftIndex = recentAnimationNames.indexOf(left.name);
    const rightIndex = recentAnimationNames.indexOf(right.name);
    if (leftIndex === -1 && rightIndex === -1) return 0;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
  const categories = ANIMATION_CATEGORY_ORDER.filter((id) => kindItems.some((item) => item.category === id));

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(RECENT_ANIMATION_STORAGE_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        setRecentAnimationNames(stored.filter((name): name is string => typeof name === "string").slice(0, RECENT_ANIMATION_LIMIT));
      }
    } catch {
      setRecentAnimationNames([]);
    }
  }, []);

  const rememberAnimation = (animation: HyperframesCatalogItem) => {
    setRecentAnimationNames((current) => {
      const next = [animation.name, ...current.filter((name) => name !== animation.name)].slice(0, RECENT_ANIMATION_LIMIT);
      try {
        window.localStorage.setItem(RECENT_ANIMATION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage may be unavailable in private or embedded contexts.
      }
      return next;
    });
  };

  return (
    <>
      <section className="mt-4 rounded-xl border border-border/80 bg-muted/25 p-3" aria-label={t("new_conversation.animations.gsap_library")}>
      <div className="flex items-start justify-between gap-3 px-0.5">
        <div>
          <p className="text-[13px] font-medium text-foreground">
            {libraryKind === "effect" ? t("new_conversation.animations.effect_library") : t("new_conversation.animations.animation_library")}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("new_conversation.animations.gsap_summary", { total: gsapItems.length, animations: animationCount, effects: effectCount })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700">{t("new_conversation.animations.catalog_synced")}</span>
          <span className={cn("rounded-full px-2 py-1 text-[11px] font-medium", selected.length ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground")}>{t("new_conversation.animations.selected", { count: selected.length })}</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 rounded-lg bg-background p-1">
        {HYPERFRAMES_LIBRARY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => {
              setLibraryKind(kind);
              setCategory(null);
              setPlugin(null);
            }}
            className={cn("h-7 rounded-md text-[11px] font-medium transition-colors", libraryKind === kind ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {kind === "animation"
              ? t("new_conversation.animations.animation_tab", { count: animationCount })
              : t("new_conversation.animations.effect_tab", { count: effectCount })}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-2.5 py-1.5 text-[10px] text-muted-foreground">
        <span>{t("new_conversation.animations.coverage", { count: kindItems.length })}</span>
        <span>{t("new_conversation.animations.engine_version", { version: kindItems[0]?.engine?.version ?? "3" })}</span>
      </div>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => setCategory(null)} className={cn("h-6 shrink-0 rounded-full px-2.5 text-[10px]", category === null ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground")}>{t("new_conversation.animations.all")}</button>
        {categories.map((id) => (
          <button key={id} type="button" onClick={() => setCategory(id)} className={cn("h-6 shrink-0 rounded-full px-2.5 text-[10px]", category === id ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground")}>{ANIMATION_CATEGORY_LABELS[id]?.[locale] ?? id}</button>
        ))}
      </div>
      {plugins.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => setPlugin(null)} className={cn("h-6 shrink-0 rounded-full border px-2.5 text-[10px]", plugin === null ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-border bg-background text-muted-foreground hover:text-foreground")}>{t("new_conversation.animations.all_plugins")}</button>
          {plugins.map((name) => (
            <button key={name} type="button" onClick={() => setPlugin(name)} className={cn("h-6 shrink-0 rounded-full border px-2.5 text-[10px]", plugin === name ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-border bg-background text-muted-foreground hover:text-foreground")}>{name}</button>
          ))}
        </div>
      ) : null}
      {loading ? (
        <div className="flex h-[112px] items-center justify-center text-xs text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />{t("new_conversation.animations.loading")}</div>
      ) : error === "empty_catalog" ? (
        <div className="flex h-[112px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/80 bg-background/55 px-4 text-center">
          <p className="text-[12px] font-medium text-foreground">{t("new_conversation.animations.empty_catalog_title")}</p>
          <p className="text-[11px] text-muted-foreground">{t("new_conversation.animations.empty_catalog_body")}</p>
        </div>
      ) : error ? (
        <div className="flex h-[112px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 bg-background/55 px-4 text-center">
          <p className="text-[12px] font-medium text-foreground">{t("new_conversation.animations.error_title")}</p>
          <p className="text-[11px] text-muted-foreground">{t("new_conversation.animations.error_body")}</p>
          <button type="button" onClick={onRetry} className="h-7 rounded-md border border-border bg-background px-3 text-[11px] font-medium text-foreground hover:bg-muted">{t("new_conversation.animations.retry")}</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-[112px] items-center justify-center text-xs text-muted-foreground">{t("new_conversation.animations.empty")}</div>
      ) : (
        <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filtered.map((item) => {
            const active = selectedNames.has(item.name);
            return (
              <AnimationCatalogCard
                key={item.name}
                item={item}
                active={active}
                configuredCount={Object.keys(selectedByName.get(item.name)?.values ?? {}).length}
                recent={recentNameSet.has(item.name)}
                locale={locale}
                onToggle={(animation) => {
                  rememberAnimation(animation);
                  onToggle?.(animation);
                }}
                onConfigure={(animation) => {
                  rememberAnimation(animation);
                  onChangeAnimationParams?.(animation, selectedByName.get(animation.name)?.values ?? {});
                  setEditingItem(animation);
                }}
              />
            );
          })}
        </div>
      )}
      </section>
      <AnimationParameterDialog
        item={editingItem}
        values={editingItem ? selectedByName.get(editingItem.name)?.values ?? {} : {}}
        onChange={(values) => {
          if (editingItem) onChangeAnimationParams?.(editingItem, values);
        }}
        onClose={() => setEditingItem(null)}
      />
    </>
  );
}

function ShortcutEditor({
  mode,
  definitions,
  selectedIds,
  templates,
  templatesLoading,
  position,
  panelRef,
  onToggle,
  onMove,
  onClose,
}: {
  mode: NewConversationMode;
  definitions: ReadonlyArray<StarterAction>;
  selectedIds: string[];
  templates: TemplateCatalogItem[];
  templatesLoading: boolean;
  position: CSSProperties;
  panelRef: Ref<HTMLDivElement>;
  onToggle: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onClose: () => void;
}) {
  const creativeMode = mode === "design";
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      data-testid="new-conversation-shortcut-editor"
      className="fixed z-[80] max-h-[min(420px,calc(100vh-2rem))] w-[min(340px,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border/80 bg-background/95 p-3 shadow-xl backdrop-blur"
      style={position}
      role="dialog"
      aria-label={t("new_conversation.shortcuts.title")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-foreground">{t("new_conversation.shortcuts.title")}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {creativeMode ? t("new_conversation.shortcuts.market_hint") : t("new_conversation.shortcuts.subtitle")}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <XMarkIcon className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 space-y-1">
        {definitions.map((action) => {
          const selectedIndex = selectedIds.indexOf(action.id);
          const selected = selectedIndex >= 0;
          const categorySynced = !action.templateCategory || templatesLoading || templates.some((template) => (
            template.manifest.category === action.templateCategory
          ));
          const ActionIcon = action.icon;
          return (
            <div key={action.id} className={cn("flex items-center gap-1 rounded-lg px-1.5 py-1", selected ? "bg-muted/55" : "hover:bg-muted/35")}>
              <button
                type="button"
                disabled={!selected && !categorySynced}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => onToggle(action.id)}
              >
                <ActionIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(action.label)}</span>
                {action.templateCategory && !categorySynced ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{t("new_conversation.shortcuts.not_synced")}</span>
                ) : selected ? (
                  <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
                ) : null}
              </button>
              {selected ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                    aria-label={t("new_conversation.shortcuts.move_up")}
                    disabled={selectedIndex === 0}
                    onClick={() => onMove(action.id, -1)}
                  >
                    <ChevronUpIcon className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                    aria-label={t("new_conversation.shortcuts.move_down")}
                    disabled={selectedIndex === selectedIds.length - 1}
                    onClick={() => onMove(action.id, 1)}
                  >
                    <ChevronDownIcon className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive"
                    aria-label={t("new_conversation.shortcuts.remove")}
                    onClick={() => onToggle(action.id)}
                  >
                    <XMarkIcon className="size-3.5" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

export function newConversationPlaceholder() {
  return t("new_conversation.placeholder");
}

export function NewConversationStarter({
  selectedMode,
  selectedCapabilityId,
  onSelectMode,
  onSelectPrompt,
  templates = [],
  templatesLoading = false,
  templateBusyId,
  getTemplateCover,
  onUseTemplate,
  onInstallTemplate,
  onRequestTemplates,
  animationCatalog = [],
  animationCatalogLoading = false,
  animationCatalogError = null,
  selectedAnimations = [],
  onToggleAnimation,
  onChangeAnimationParams,
  onRetryAnimationCatalog,
}: NewConversationStarterProps) {
  const modeTabIndicatorId = useId();
  const reduceMotion = useReducedMotion();
  const [activeTemplateCategory, setActiveTemplateCategory] = useState<TemplateCategory | null>(null);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [shortcutEditorPosition, setShortcutEditorPosition] = useState<CSSProperties>({});
  const [shortcutIds, setShortcutIds] = useState<Record<NewConversationMode, string[]>>(DEFAULT_SHORTCUT_IDS);
  const shortcutEditorRef = useRef<HTMLDivElement>(null);
  const shortcutEditorPanelRef = useRef<HTMLDivElement>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? "null") as Partial<Record<NewConversationMode, unknown>> | null;
      if (!stored) return;
      setShortcutIds((current) => {
        const next = { ...current };
        for (const mode of Object.keys(DEFAULT_SHORTCUT_IDS) as NewConversationMode[]) {
          const definitions = MODE_ACTIONS[mode];
          const validIds = new Set(definitions.map((action) => action.id));
          const value = stored[mode];
          if (Array.isArray(value)) next[mode] = value.filter((id): id is string => typeof id === "string" && validIds.has(id));
        }
        return next;
      });
    } catch {
      // An invalid local preference should never block the new conversation UI.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcutIds));
  }, [shortcutIds]);

  useEffect(() => {
    if (!shortcutEditorOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        !shortcutEditorRef.current?.contains(event.target)
        && !shortcutEditorPanelRef.current?.contains(event.target)
      ) setShortcutEditorOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShortcutEditorOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [shortcutEditorOpen]);

  const updateShortcutEditorPosition = () => {
    const button = shortcutButtonRef.current;
    if (!button || typeof window === "undefined") return;
    const rect = button.getBoundingClientRect();
    const contentRect = button.closest<HTMLElement>('[data-slot="sidebar-inset"]')?.getBoundingClientRect();
    const contentLeft = contentRect?.left ?? 0;
    const contentRight = contentRect?.right ?? window.innerWidth;
    const horizontalMargin = 16;
    const width = Math.min(340, Math.max(0, contentRight - contentLeft - horizontalMargin * 2));
    const left = Math.min(
      Math.max(rect.right - width, contentLeft + horizontalMargin),
      contentRight - horizontalMargin - width,
    );
    const verticalMargin = 16;
    const gap = 8;
    const availableAbove = Math.max(0, rect.top - gap - verticalMargin);
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - verticalMargin);
    const opensAbove = availableAbove > availableBelow;
    const maxHeight = Math.min(420, opensAbove ? availableAbove : availableBelow);
    setShortcutEditorPosition(opensAbove
      ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + gap }
      : { left, width, maxHeight, top: rect.bottom + gap });
  };

  useEffect(() => {
    if (!shortcutEditorOpen) return;
    updateShortcutEditorPosition();
    window.addEventListener("resize", updateShortcutEditorPosition);
    window.addEventListener("scroll", updateShortcutEditorPosition, true);
    return () => {
      window.removeEventListener("resize", updateShortcutEditorPosition);
      window.removeEventListener("scroll", updateShortcutEditorPosition, true);
    };
  }, [shortcutEditorOpen]);

  const modeDefinitions = MODE_ACTIONS[selectedMode];
  const actions = shortcutIds[selectedMode]
    .map((id) => modeDefinitions.find((action) => action.id === id))
    .filter((action): action is StarterAction => Boolean(action));
  const toggleShortcut = (id: string) => {
    const definition = modeDefinitions.find((action) => action.id === id);
    if (!definition) return;
    const categorySynced = !definition.templateCategory || templatesLoading || templates.some((template) => template.manifest.category === definition.templateCategory);
    if (definition.templateCategory && !categorySynced) return;
    setShortcutIds((current) => {
      const selected = current[selectedMode];
      return {
        ...current,
        [selectedMode]: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
      };
    });
  };

  const moveShortcut = (id: string, direction: -1 | 1) => {
    setShortcutIds((current) => {
      const selected = [...current[selectedMode]];
      const index = selected.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= selected.length) return current;
      [selected[index], selected[nextIndex]] = [selected[nextIndex], selected[index]];
      return { ...current, [selectedMode]: selected };
    });
  };

  const selectMode = (mode: NewConversationMode) => {
    setActiveTemplateCategory(null);
    setShortcutEditorOpen(false);
    if (mode === "design" || (mode === "video" && VIDEO_TEMPLATE_PICKER_ENABLED)) {
      onRequestTemplates?.();
    }
    onSelectMode(mode);
  };

  return (
    <div data-testid="new-conversation-starter-layout" className="relative w-full overflow-visible px-6 pt-8 sm:px-0 sm:pt-12">
      <img
        src={publicAssetUrl("new-conversation-bg.png")}
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-[calc(50%-280px)] -top-[18px] h-[243px] w-[243px] max-w-none dark:opacity-20"
      />
      <div data-testid="new-conversation-starter-header" className="relative">
        <div className="max-w-4xl">
          <img
            src={publicAssetUrl("ipollo-work-wordmark.svg")}
            alt="iPollo Work"
            className="h-[25px] w-[144px] dark:invert dark:opacity-80"
          />
          <h1 className="mt-3 font-sans text-[48px] font-semibold leading-none tracking-[-1.92px] text-black dark:text-white">
            {t("new_conversation.title")}
          </h1>
        </div>

        <LazyMotion features={domAnimation}>
          <div
            className="mt-8 flex h-[42px] w-fit max-w-full items-center gap-2 rounded-[40px] bg-[var(--new-conversation-tab-surface)] p-1"
            role="tablist"
            aria-label={t("new_conversation.mode_label")}
          >
          {MODES.map(({ id, iconSrc, label }) => {
            const selected = id === selectedMode;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(
                  "relative isolate inline-flex w-[92px] min-w-0 items-center justify-center gap-1 px-3 font-['PingFang_SC'] text-[13px] font-medium leading-[20px] transition-[background-color,border-radius,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "h-9 rounded-[40px] text-[var(--new-conversation-tab-text)]"
                    : "h-[38px] rounded-[12px] text-[var(--new-conversation-tab-muted)] hover:rounded-[40px] hover:bg-[var(--new-conversation-tab-selected)]/70 hover:text-[var(--new-conversation-tab-text)]",
                )}
                onClick={() => selectMode(id)}
              >
                {selected ? (
                  <m.span
                    layoutId={`new-conversation-mode-indicator-${modeTabIndicatorId}`}
                    data-testid="new-conversation-mode-indicator"
                    aria-hidden="true"
                    initial={false}
                    transition={reduceMotion ? { duration: 0 } : MODE_TAB_SPRING}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[40px] bg-[var(--new-conversation-tab-selected)]"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className="size-[16px] shrink-0 bg-current transition-opacity duration-150"
                  style={{
                    WebkitMaskImage: `url(${iconSrc})`,
                    maskImage: `url(${iconSrc})`,
                    WebkitMaskPosition: "center",
                    maskPosition: "center",
                    WebkitMaskRepeat: "no-repeat",
                    maskRepeat: "no-repeat",
                    WebkitMaskSize: "contain",
                    maskSize: "contain",
                  }}
                />
                <span className="min-w-0 truncate">{t(label)}</span>
              </button>
            );
          })}
          </div>
        </LazyMotion>
      </div>

      <div data-testid="new-conversation-starter-tasks" className="relative pt-6">
        <div
          data-testid="new-conversation-quick-actions"
          className={cn(
            "flex flex-wrap gap-2",
            selectedMode === "video" ? "" : "min-h-[56px] content-start",
          )}
          aria-label={t("new_conversation.quick_actions_label")}
        >
        {actions.map(({ id, label, prompt, templateCategory, icon: ActionIcon }) => {
          const selectedTemplateAction = templateCategory !== undefined && templateCategory === activeTemplateCategory;
          const selectedCapabilityAction = !templateCategory && selectedCapabilityId === id;
          const selected = selectedTemplateAction || selectedCapabilityAction;
          const isWebsiteAction = id === "site";
          return (
            <button
              key={id}
              type="button"
              aria-pressed={templateCategory !== undefined ? selectedTemplateAction : selectedCapabilityAction}
              className={cn(
                "new-conversation-quick-action inline-flex h-7 items-center justify-center gap-1.5 rounded-[18px] border px-2 py-1 text-[11px] font-normal leading-4 transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected
                  ? "border-[#E0DDC3] bg-[#F4F4EE] text-[#161E24] dark:border-[#666] dark:bg-[#343434] dark:text-[#f5f5f5]"
                  : "border-[#EBEBEB] bg-transparent text-[#5A6774] hover:border-[#EBEBEB] hover:bg-[#EFEFEF] dark:border-[#666] dark:text-[#b0b4ba] dark:hover:border-[#999] dark:hover:bg-[#343434] dark:hover:text-[#f5f5f5]",
              )}
              onClick={() => {
                if (templateCategory) {
                  onRequestTemplates?.();
                  setActiveTemplateCategory((current) => current === templateCategory ? null : templateCategory);
                } else if (prompt) {
                  onSelectPrompt("", selectedCapabilityAction ? undefined : {
                    id,
                    label: t(label),
                    icon: ActionIcon,
                    instruction: t(prompt),
                  });
                }
              }}
            >
              {isWebsiteAction ? (
                <span className="relative size-3.5 shrink-0">
                  <img
                    src={selected ? QUICK_TASK_GLOBE_SELECTED_ASSET : QUICK_TASK_GLOBE_ASSET}
                    alt=""
                    aria-hidden
                    className={cn("absolute inset-[8.33%] size-[83.34%]", selected && "dark:invert")}
                  />
                </span>
              ) : (
                <ActionIcon className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="whitespace-nowrap">{t(label)}</span>
            </button>
          );
        })}
        {selectedMode !== "video" && selectedMode !== "code" ? (
          <div ref={shortcutEditorRef} className="relative">
            <button
              ref={shortcutButtonRef}
              type="button"
              className={cn(
                "inline-flex size-[24px] items-center justify-center rounded-full border text-muted-foreground transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                shortcutEditorOpen
                  ? "border-[#CCC] bg-[#F5F5F5] text-foreground dark:border-[#666] dark:bg-[#343434]"
                  : "border-[#CBCBCB] bg-white hover:border-[#CCC] hover:bg-[#F5F5F5] hover:text-foreground dark:border-[#666] dark:bg-transparent dark:hover:border-[#999] dark:hover:bg-[#343434]",
              )}
              aria-label={t("new_conversation.shortcuts.add")}
              aria-expanded={shortcutEditorOpen}
              onClick={() => {
                if (selectedMode === "design") onRequestTemplates?.();
                updateShortcutEditorPosition();
                setShortcutEditorOpen((open) => !open);
              }}
            >
              <span className="relative size-4 shrink-0">
                <img src={QUICK_TASK_PLUS_ASSET} alt="" aria-hidden className="absolute inset-[20.83%] size-[58.34%]" />
              </span>
            </button>
          </div>
        ) : null}
        </div>

        {selectedMode === "design" && activeTemplateCategory ? (
          <TemplateStrip
            templates={templates}
            loading={templatesLoading}
            busyId={templateBusyId}
            category={activeTemplateCategory}
            getTemplateCover={getTemplateCover}
            onUseTemplate={onUseTemplate}
            onInstallTemplate={onInstallTemplate}
            onRequestTemplates={onRequestTemplates}
          />
        ) : null}
        {selectedMode === "video" && VIDEO_ANIMATION_PICKER_ENABLED ? (
          <AnimationCatalogStrip
            items={animationCatalog}
            loading={animationCatalogLoading}
            error={animationCatalogError}
            selected={selectedAnimations}
            onToggle={onToggleAnimation}
            onChangeAnimationParams={onChangeAnimationParams}
            onRetry={onRetryAnimationCatalog}
          />
        ) : null}
        {selectedMode === "video" && VIDEO_TEMPLATE_PICKER_ENABLED ? (
          <TemplateStrip
            templates={templates}
            loading={templatesLoading}
            busyId={templateBusyId}
            category="video"
            getTemplateCover={getTemplateCover}
            onUseTemplate={onUseTemplate}
            onInstallTemplate={onInstallTemplate}
            onRequestTemplates={onRequestTemplates}
          />
        ) : null}
      </div>
      {shortcutEditorOpen ? (
        <ShortcutEditor
          mode={selectedMode}
          definitions={modeDefinitions}
          selectedIds={shortcutIds[selectedMode]}
          templates={templates}
          templatesLoading={templatesLoading}
          position={shortcutEditorPosition}
          panelRef={shortcutEditorPanelRef}
          onToggle={toggleShortcut}
          onMove={moveShortcut}
          onClose={() => setShortcutEditorOpen(false)}
        />
      ) : null}
    </div>
  );
}

