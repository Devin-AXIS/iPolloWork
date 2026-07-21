"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
  Table2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { isPptxCompatibleTemplate, type TemplateCatalogItem } from "@ipollowork/types/templates";

import { publicAssetUrl } from "@/app/lib/public-asset";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type NewConversationMode = "work" | "code" | "design" | "video";

type Icon = LucideIcon;
type TemplateCoverLoader = (templateId: string) => Promise<{ data: ArrayBuffer; contentType?: string | null }>;

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
};

const MODES = [
  { id: "work", iconSrc: publicAssetUrl("new-conversation-tabs/work.svg"), label: "new_conversation.mode.work" },
  { id: "code", iconSrc: publicAssetUrl("new-conversation-tabs/code.svg"), label: "new_conversation.mode.code" },
  { id: "design", iconSrc: publicAssetUrl("new-conversation-tabs/design.svg"), label: "new_conversation.mode.design" },
  { id: "video", iconSrc: publicAssetUrl("new-conversation-tabs/video.svg"), label: "new_conversation.mode.video" },
] as const satisfies ReadonlyArray<{ id: NewConversationMode; iconSrc: string; label: string }>;

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

const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, () => string> = {
  site: () => t("new_conversation.template_category.site"),
  poster: () => t("new_conversation.template_category.poster"),
  cards: () => t("new_conversation.template_category.cards"),
  app: () => t("new_conversation.template_category.app"),
  article: () => t("new_conversation.template_category.article"),
  slides: () => t("new_conversation.template_category.slides"),
  report: () => t("new_conversation.template_category.report"),
  other: () => t("new_conversation.template_category.other"),
  video: () => t("new_conversation.template_category.video"),
};

const NEW_CONVERSATION_PLACEHOLDERS: Record<NewConversationMode, () => string> = {
  work: () => t("new_conversation.placeholder.work"),
  code: () => t("new_conversation.placeholder.code"),
  design: () => t("new_conversation.placeholder.design"),
  video: () => t("new_conversation.placeholder.video"),
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
}: {
  templates: TemplateCatalogItem[];
  loading: boolean;
  busyId?: string | null;
  category: TemplateCategory;
  getTemplateCover?: TemplateCoverLoader;
  onUseTemplate?: (templateId: string, surface: "design" | "video") => void;
  onInstallTemplate?: (templateId: string) => void;
}) {
  const categoryTemplates = templates.filter((template) => (
    template.manifest.category === category && (category !== "video" || template.manifest.surface === "video")
  ));
  const categoryLabel = TEMPLATE_CATEGORY_LABELS[category]();
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
    <section className="mt-4 rounded-xl border border-border/80 bg-muted/25 p-3" aria-live="polite">
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
                  {isPptxCompatibleTemplate(template.manifest) ? <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground shadow-sm">PPTX-compatible</span> : null}
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
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          {t("new_conversation.templates.empty", { category: categoryLabel })}
        </p>
      )}
    </section>
  );
}

function ShortcutEditor({
  mode,
  definitions,
  selectedIds,
  templates,
  templatesLoading,
  position,
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
  onToggle: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onClose: () => void;
}) {
  const creativeMode = mode === "design";
  return (
    <div
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
    </div>
  );
}

export function newConversationPlaceholder(mode: NewConversationMode) {
  return NEW_CONVERSATION_PLACEHOLDERS[mode]();
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
}: NewConversationStarterProps) {
  const [activeTemplateCategory, setActiveTemplateCategory] = useState<TemplateCategory | null>(null);
  const [hoveredMode, setHoveredMode] = useState<NewConversationMode | null>(null);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [shortcutEditorPosition, setShortcutEditorPosition] = useState<CSSProperties>({});
  const [shortcutIds, setShortcutIds] = useState<Record<NewConversationMode, string[]>>(DEFAULT_SHORTCUT_IDS);
  const shortcutEditorRef = useRef<HTMLDivElement>(null);
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
      if (!shortcutEditorRef.current?.contains(event.target as Node)) setShortcutEditorOpen(false);
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
    const right = Math.max(16, window.innerWidth - rect.right);
    const opensAbove = rect.bottom > window.innerHeight * 0.58;
    setShortcutEditorPosition(opensAbove
      ? { right, bottom: Math.max(16, window.innerHeight - rect.top + 8) }
      : { right, top: Math.max(16, rect.bottom + 8) });
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
    if (mode === "design" || mode === "video") onRequestTemplates?.();
    onSelectMode(mode);
  };

  return (
    <div className="relative w-full overflow-visible px-6 py-8 sm:px-0 sm:pb-0 sm:pt-12">
      <img
        src={publicAssetUrl("new-conversation-bg.png")}
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-[calc(50%-280px)] -top-[18px] h-[243px] w-[243px] max-w-none"
      />
      <div className="relative">
        <div className="max-w-4xl">
          <img src={publicAssetUrl("ipollo-work-wordmark.svg")} alt="iPollo Work" className="h-[25px] w-[144px]" />
          <h1 className="mt-3 font-sans text-[48px] font-semibold leading-none tracking-[-1.92px] text-black">
            {t("new_conversation.title")}
          </h1>
          <p className="mt-8 font-sans text-[16px] font-light leading-normal tracking-[-0.8px] text-[#666]">{t("new_conversation.subtitle")}</p>
        </div>

        <div
          className="mt-8 grid h-[46px] w-full max-w-[394px] grid-cols-4 items-center gap-1.5 rounded-[12px] bg-[#F5F5F5] p-1"
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
                "inline-flex h-[38px] min-w-0 items-center justify-center gap-1.5 rounded-[8px] px-1.5 font-sans text-[12px] font-medium leading-normal transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected
                  ? "bg-white text-black"
                  : "text-[#999] hover:bg-white/70 hover:text-black",
              )}
              onClick={() => selectMode(id)}
              onMouseEnter={() => setHoveredMode(id)}
              onMouseLeave={() => setHoveredMode(null)}
            >
              <img
                src={iconSrc}
                alt=""
                aria-hidden
                className={cn("shrink-0 object-contain", id === "video" ? "h-[14px] w-[18px]" : "size-4", (selected || hoveredMode === id) && "brightness-0")}
              />
              <span className="min-w-0 truncate">{t(label)}</span>
            </button>
          );
        })}
        </div>

        <div className="mt-5 flex flex-wrap gap-2" aria-label={t("new_conversation.quick_actions_label")}>
        {actions.map(({ id, label, prompt, templateCategory, icon: ActionIcon }) => {
          const selectedTemplateAction = templateCategory !== undefined && templateCategory === activeTemplateCategory;
          const selectedCapabilityAction = !templateCategory && selectedCapabilityId === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={templateCategory !== undefined ? selectedTemplateAction : selectedCapabilityAction}
              className={cn(
                "inline-flex h-[24px] min-w-[50px] items-center justify-center rounded-[18px] border px-2 text-[12px] font-medium transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selectedTemplateAction || selectedCapabilityAction
                  ? "border-[#CCC] bg-[#F5F5F5] text-[#999]"
                  : "border-[#CBCBCB] bg-white text-[#999] hover:border-[#CCC] hover:bg-[#F5F5F5]",
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
              <ActionIcon className="mr-1 size-3.5 shrink-0" aria-hidden />
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
                shortcutEditorOpen ? "border-[#CCC] bg-[#F5F5F5] text-foreground" : "border-[#CBCBCB] bg-white hover:border-[#CCC] hover:bg-[#F5F5F5] hover:text-foreground",
              )}
              aria-label={t("new_conversation.shortcuts.add")}
              aria-expanded={shortcutEditorOpen}
              onClick={() => {
                if (selectedMode === "design") onRequestTemplates?.();
                updateShortcutEditorPosition();
                setShortcutEditorOpen((open) => !open);
              }}
            >
              <Plus className="size-4 text-[#999]" strokeWidth={1.8} aria-hidden />
            </button>
            {shortcutEditorOpen ? (
              <ShortcutEditor
                mode={selectedMode}
                definitions={modeDefinitions}
                selectedIds={shortcutIds[selectedMode]}
                templates={templates}
                templatesLoading={templatesLoading}
                position={shortcutEditorPosition}
                onToggle={toggleShortcut}
                onMove={moveShortcut}
                onClose={() => setShortcutEditorOpen(false)}
              />
            ) : null}
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
          />
        ) : null}
        {selectedMode === "video" ? (
          <TemplateStrip
            templates={templates}
            loading={templatesLoading}
            busyId={templateBusyId}
            category="video"
            getTemplateCover={getTemplateCover}
            onUseTemplate={onUseTemplate}
            onInstallTemplate={onInstallTemplate}
          />
        ) : null}
      </div>
    </div>
  );
}
