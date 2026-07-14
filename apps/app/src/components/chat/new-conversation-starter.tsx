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
} from "@heroicons/react/24/solid";
import type { TemplateCatalogItem } from "@ipollowork/types/templates";

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
  { id: "work", icon: BriefcaseIcon, label: "new_conversation.mode.work" },
  { id: "code", icon: CodeBracketIcon, label: "new_conversation.mode.code" },
  { id: "design", icon: PaintBrushIcon, label: "new_conversation.mode.design" },
  { id: "video", icon: FilmIcon, label: "new_conversation.mode.video" },
] as const satisfies ReadonlyArray<{ id: NewConversationMode; icon: Icon; label: string }>;

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
    void getTemplateCover(template.manifest.id).then(({ data, contentType }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([data], { type: contentType ?? "image/svg+xml" }));
      setSrc(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [getTemplateCover, template.manifest.id]);

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
  const actions = MODE_ACTIONS[selectedMode];

  const selectMode = (mode: NewConversationMode) => {
    setWebsiteTemplatesOpen(false);
    if (mode === "design") onRequestWebsiteTemplates?.();
    onSelectMode(mode);
  };

  return (
    <div className="w-full">
      <header className="max-w-xl">
        <p className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-[2.5rem]">iPolloWork</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">
          {t("new_conversation.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t("new_conversation.subtitle")}</p>
      </header>

      <div
        className="mt-5 inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-xl border border-border bg-muted/45 p-0.5"
        role="tablist"
        aria-label={t("new_conversation.mode_label")}
      >
        {MODES.map(({ id, icon: Icon, label }) => {
          const selected = id === selectedMode;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected
                  ? "bg-background text-primary shadow-sm ring-1 ring-primary/20"
                  : "text-muted-foreground hover:bg-background/75 hover:text-foreground",
              )}
              onClick={() => selectMode(id)}
            >
              <Icon className="size-3.5" aria-hidden />
              <span>{t(label)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-7 flex flex-wrap gap-1.5" aria-label={t("new_conversation.quick_actions_label")}>
        {actions.map(({ label, icon: Icon, prompt, action }) => {
          const selectedWebsiteAction = action === "website" && websiteTemplatesOpen;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={action === "website" ? websiteTemplatesOpen : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selectedWebsiteAction
                  ? "border-primary/35 bg-primary/10 text-primary shadow-sm"
                  : "border-border bg-background text-foreground shadow-sm hover:border-primary/25 hover:bg-muted",
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
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
              <span>{t(label)}</span>
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
  );
}
