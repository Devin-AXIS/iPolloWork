"use client";

import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import {
  BriefcaseIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  FilmIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  PresentationChartLineIcon,
  RectangleStackIcon,
  VideoCameraIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import type { TemplateCatalogItem } from "@ipollowork/types/templates";

import { publicAssetUrl } from "@/app/lib/public-asset";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type NewConversationMode = "work" | "code" | "design" | "video";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type TemplateCoverLoader = (templateId: string) => Promise<{ data: ArrayBuffer; contentType?: string | null }>;

type NewConversationStarterProps = {
  selectedMode: NewConversationMode;
  onSelectMode: (mode: NewConversationMode) => void;
  onSelectPrompt: (prompt: string) => void;
  onCreateVideoSession?: () => void;
  websiteTemplates?: TemplateCatalogItem[];
  websiteTemplatesLoading?: boolean;
  websiteTemplateBusyId?: string | null;
  getTemplateCover?: TemplateCoverLoader;
  onUseWebsiteTemplate?: (templateId: string) => void;
  onInstallWebsiteTemplate?: (templateId: string) => void;
  onRequestWebsiteTemplates?: () => void;
};

const MODES = [
  { id: "work", iconSrc: publicAssetUrl("new-conversation-tabs/work.svg"), label: "new_conversation.mode.work" },
  { id: "code", iconSrc: publicAssetUrl("new-conversation-tabs/code.svg"), label: "new_conversation.mode.code" },
  { id: "design", iconSrc: publicAssetUrl("new-conversation-tabs/design.svg"), label: "new_conversation.mode.design" },
  { id: "video", iconSrc: publicAssetUrl("new-conversation-tabs/video.svg"), label: "new_conversation.mode.video" },
] as const satisfies ReadonlyArray<{ id: NewConversationMode; iconSrc: string; label: string }>;

type StarterAction = {
  label: string;
  icon: Icon;
  prompt?: string;
  action?: "video" | "website";
};

const MODE_ACTIONS: Record<NewConversationMode, ReadonlyArray<StarterAction>> = {
  work: [
    { label: "new_conversation.action.document", icon: DocumentTextIcon, prompt: "new_conversation.prompt.document" },
    { label: "new_conversation.action.data", icon: ChartBarIcon, prompt: "new_conversation.prompt.data" },
    { label: "new_conversation.action.plan", icon: ChatBubbleLeftRightIcon, prompt: "new_conversation.prompt.plan" },
  ],
  code: [
    { label: "new_conversation.action.understand_code", icon: MagnifyingGlassIcon, prompt: "new_conversation.prompt.understand_code" },
    { label: "new_conversation.action.build_feature", icon: WrenchScrewdriverIcon, prompt: "new_conversation.prompt.build_feature" },
    { label: "new_conversation.action.debug", icon: CodeBracketIcon, prompt: "new_conversation.prompt.debug" },
  ],
  design: [
    { label: "new_conversation.action.website", icon: GlobeAltIcon, action: "website" },
    { label: "new_conversation.action.presentation", icon: PresentationChartLineIcon, prompt: "new_conversation.prompt.make_presentation" },
  ],
  video: [
    { label: "new_conversation.action.video_script", icon: DocumentTextIcon, prompt: "new_conversation.prompt.video_script" },
    { label: "new_conversation.action.storyboard", icon: RectangleStackIcon, prompt: "new_conversation.prompt.storyboard" },
    { label: "new_conversation.action.video_studio", icon: VideoCameraIcon, action: "video" },
  ],
};

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

function WebsiteTemplateStrip({
  templates,
  loading,
  busyId,
  getTemplateCover,
  onUseTemplate,
  onInstallTemplate,
}: {
  templates: TemplateCatalogItem[];
  loading: boolean;
  busyId?: string | null;
  getTemplateCover?: TemplateCoverLoader;
  onUseTemplate?: (templateId: string) => void;
  onInstallTemplate?: (templateId: string) => void;
}) {
  const websiteTemplates = templates.filter((template) => template.manifest.category === "site");

  return (
    <section className="mt-4 rounded-xl border border-border/80 bg-muted/25 p-3" aria-live="polite">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-0.5">
        <div>
          <p className="text-[13px] font-medium text-foreground">{t("new_conversation.website_templates.title")}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("new_conversation.website_templates.subtitle")}</p>
        </div>
        <GlobeAltIcon className="size-4 shrink-0 text-primary/70" aria-hidden />
      </div>

      {loading ? (
        <div className="flex gap-2 overflow-hidden" aria-label={t("new_conversation.website_templates.loading")}>
          {[0, 1, 2].map((index) => <div key={index} className="h-[106px] min-w-[172px] animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : websiteTemplates.length ? (
        <div className="-mx-0.5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {websiteTemplates.map((template) => {
            const busy = busyId === template.manifest.id;
            const canUse = template.installed && Boolean(onUseTemplate);
            const label = template.installed ? t("new_conversation.website_templates.use") : t("new_conversation.website_templates.install");
            return (
              <button
                key={template.manifest.id}
                type="button"
                disabled={busy || (!canUse && !onInstallTemplate)}
                className="group min-w-[172px] snap-start overflow-hidden rounded-lg border border-border/80 bg-background text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
                onClick={() => {
                  if (template.installed) onUseTemplate?.(template.manifest.id);
                  else onInstallTemplate?.(template.manifest.id);
                }}
              >
                <div className="h-14 overflow-hidden border-b border-border/60 bg-muted/60"><TemplateThumbnail template={template} getTemplateCover={getTemplateCover} /></div>
                <div className="p-2">
                  <div className="truncate text-[12px] font-medium text-foreground">{template.manifest.title}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate">{template.sourceType === "local" ? t("new_conversation.website_templates.local") : template.manifest.source.name}</span>
                    <span className="shrink-0 font-medium text-primary">{busy ? "…" : label}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          {t("new_conversation.website_templates.empty")}
        </p>
      )}
    </section>
  );
}

export function newConversationPlaceholder(mode: NewConversationMode) {
  return t(`new_conversation.placeholder.${mode}`);
}

export function NewConversationStarter({
  selectedMode,
  onSelectMode,
  onSelectPrompt,
  onCreateVideoSession,
  websiteTemplates = [],
  websiteTemplatesLoading = false,
  websiteTemplateBusyId,
  getTemplateCover,
  onUseWebsiteTemplate,
  onInstallWebsiteTemplate,
  onRequestWebsiteTemplates,
}: NewConversationStarterProps) {
  const [websiteTemplatesOpen, setWebsiteTemplatesOpen] = useState(false);
  const [hoveredMode, setHoveredMode] = useState<NewConversationMode | null>(null);
  const actions = MODE_ACTIONS[selectedMode];

  const selectMode = (mode: NewConversationMode) => {
    setWebsiteTemplatesOpen(false);
    if (mode === "design") onRequestWebsiteTemplates?.();
    onSelectMode(mode);
  };

  return (
    <div className="relative w-full overflow-hidden px-6 py-8 sm:px-0 sm:pb-0 sm:pt-12">
      <img
        src={publicAssetUrl("new-conversation-bg.png")}
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-[calc(50%-280px)] -top-[18px] h-[243px] w-[243px] max-w-none"
      />
      <div className="relative">
        <header className="max-w-4xl">
          <img src={publicAssetUrl("ipollo-work-wordmark.svg")} alt="iPollo Work" className="h-[25px] w-[144px]" />
          <h1 className="mt-3 font-['PingFang_SC',_'PingFang_SC'] text-[48px] font-semibold leading-normal tracking-[-1.92px] text-black">
            {t("new_conversation.title")}
          </h1>
          <p className="mt-8 font-['PingFang_SC',_'PingFang_SC'] text-[16px] font-light leading-normal tracking-[-0.8px] text-[#666]">{t("new_conversation.subtitle")}</p>
        </header>

        <div
          className="mt-8 flex h-[46px] w-full max-w-[394px] items-center gap-1.5 overflow-x-auto rounded-[12px] bg-[#F5F5F5] p-1 [scrollbar-width:none] sm:inline-flex sm:w-[394px] sm:max-w-[394px] [&::-webkit-scrollbar]:hidden"
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
                "inline-flex h-[38px] w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2 font-['PingFang_SC'] text-[12px] font-medium leading-normal transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
              <span>{t(label)}</span>
            </button>
          );
        })}
        </div>

        <div className="mt-5 flex flex-wrap gap-2" aria-label={t("new_conversation.quick_actions_label")}>
        {actions.map(({ label, prompt, action }) => {
          const selectedWebsiteAction = action === "website" && websiteTemplatesOpen;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={action === "website" ? websiteTemplatesOpen : undefined}
              className={cn(
                "inline-flex h-[24px] min-w-[50px] items-center justify-center rounded-[18px] border px-2 text-[12px] font-medium transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selectedWebsiteAction
                  ? "border-[#CCC] bg-[#F5F5F5] text-[#999]"
                  : "border-[#CBCBCB] bg-white text-[#999] hover:border-[#CCC] hover:bg-[#F5F5F5]",
              )}
              onClick={() => {
                if (action === "video") onCreateVideoSession?.();
                else if (action === "website") {
                  onRequestWebsiteTemplates?.();
                  setWebsiteTemplatesOpen((open) => !open);
                }
                else if (prompt) onSelectPrompt(t("new_conversation.prompt.start", { action: t(label) }));
              }}
              disabled={action === "video" && !onCreateVideoSession}
            >
              <span className="whitespace-nowrap">{t(label)}</span>
            </button>
          );
        })}
        </div>

        {selectedMode === "design" && websiteTemplatesOpen ? (
          <WebsiteTemplateStrip
            templates={websiteTemplates}
            loading={websiteTemplatesLoading}
            busyId={websiteTemplateBusyId}
            getTemplateCover={getTemplateCover}
            onUseTemplate={onUseWebsiteTemplate}
            onInstallTemplate={onInstallWebsiteTemplate}
          />
        ) : null}
      </div>
    </div>
  );
}
