/** @jsxImportSource react */
import * as React from "react";
import {
  BookImage,
  Building2,
  Check,
  ChartBarBig,
  ChevronDown,
  Clapperboard,
  Download,
  FileImage,
  Folders,
  Globe2,
  IdCard,
  LayoutTemplate,
  Loader2,
  PictureInPicture2,
  Presentation,
  Search,
  Star,
  type LucideIcon,
} from "lucide-react";
import {
  TEMPLATE_STYLE_LABELS,
  TEMPLATE_PACKAGE_FILE_ACCEPT,
  isPptxCompatibleTemplate,
  type TemplateCatalogItem,
  type TemplateCategory,
  type TemplateStyle,
} from "@ipollowork/types/templates";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { WorkContextId } from "@/app/lib/work-context";
import type { EnterpriseConnection, EnterpriseResource } from "@/app/lib/enterprise-connections";
import { WorkResourceScopeSwitch } from "@/react-app/domains/enterprise/work-resource-scope-switch";

type TemplateCoverLoader = (templateId: string) => Promise<{ data: ArrayBuffer; contentType?: string | null }>;
type TemplatePreviewSelection = { template: TemplateCatalogItem; enterpriseResourceId?: string };

type CategoryDefinition = {
  id: TemplateCategory;
  labelKey: string;
  icon: LucideIcon;
};

const CATEGORIES: CategoryDefinition[] = [
  { id: "site", labelKey: "template_market.category.site", icon: Globe2 },
  { id: "video", labelKey: "template_market.category.video", icon: Clapperboard },
  { id: "slides", labelKey: "template_market.category.slides", icon: Presentation },
  { id: "app", labelKey: "template_market.category.app", icon: PictureInPicture2 },
  { id: "poster", labelKey: "template_market.category.poster", icon: FileImage },
  { id: "cards", labelKey: "template_market.category.cards", icon: IdCard },
  { id: "report", labelKey: "template_market.category.report", icon: ChartBarBig },
  { id: "article", labelKey: "template_market.category.article", icon: BookImage },
  { id: "other", labelKey: "template_market.category.other", icon: Folders },
];

const PRIMARY_CATEGORIES = CATEGORIES.slice(0, 4);
const MORE_CATEGORIES = CATEGORIES.slice(4);

const STYLE_ORDER = Object.keys(TEMPLATE_STYLE_LABELS) as TemplateStyle[];
const templateStyleLabel = (style: TemplateStyle) => t(`template_market.style.${style}`);
const TEMPLATE_COVER_TIMEOUT_MS = 12_000;
const TEMPLATE_COVER_ROOT_MARGIN = "480px 0px";
const FAVORITE_TEMPLATE_IDS_STORAGE_KEY = "ipollowork.template-favorites.v1";

type TemplateMarketView = "explore" | "my";
type MyTemplateCollection = "all" | "favorites" | "mine";

const TEMPLATE_MARKET_VIEWS: TemplateMarketView[] = ["explore", "my"];
const MY_TEMPLATE_COLLECTIONS: MyTemplateCollection[] = ["all", "favorites", "mine"];

function readFavoriteTemplateIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVORITE_TEMPLATE_IDS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function writeFavoriteTemplateIds(ids: ReadonlySet<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAVORITE_TEMPLATE_IDS_STORAGE_KEY, JSON.stringify([...ids]));
}

function templateFormatLabel(template: TemplateCatalogItem) {
  if (isPptxCompatibleTemplate(template.manifest)) return "PPTX";
  return template.manifest.surface === "video" ? "Video" : "HTML";
}

function templateMatches(input: { template: TemplateCatalogItem; category: TemplateCategory | "all"; style: TemplateStyle | "all"; query: string }) {
  const { template, category, style, query } = input;
  if (category !== "all" && template.manifest.category !== category) return false;
  if (style !== "all" && template.manifest.style !== style) return false;
  if (!query) return true;
  return [template.manifest.title, template.manifest.description, template.manifest.subcategory, template.manifest.style, ...template.manifest.tags]
    .join(" ").toLowerCase().includes(query);
}

function enterpriseResourceMatches(input: { resource: EnterpriseResource; category: TemplateCategory | "all"; query: string }) {
  const { resource, category, query } = input;
  if (category !== "all" && resource.category !== category) return false;
  return !query || [resource.name, resource.description, resource.category, resource.enterpriseCategory]
    .join(" ").toLowerCase().includes(query);
}

function TemplateCover({ template, getCover, className, alt = "", eager = false }: { template: TemplateCatalogItem; getCover: TemplateCoverLoader; className?: string; alt?: string; eager?: boolean }) {
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = React.useState(eager);
  const [src, setSrc] = React.useState("");
  const [failed, setFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    if (eager || shouldLoad) {
      if (eager) setShouldLoad(true);
      return;
    }
    const target = placeholderRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: TEMPLATE_COVER_ROOT_MARGIN });
    observer.observe(target);
    return () => observer.disconnect();
  }, [eager, shouldLoad]);

  React.useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    let objectUrl = "";
    const timeout = window.setTimeout(() => {
      if (active) setFailed(true);
    }, TEMPLATE_COVER_TIMEOUT_MS);
    setSrc("");
    setFailed(false);
    void getCover(template.manifest.id).then(({ data, contentType }) => {
      if (!active) return;
      window.clearTimeout(timeout);
      objectUrl = URL.createObjectURL(new Blob([data], { type: contentType ?? "image/svg+xml" }));
      setSrc(objectUrl);
    }).catch(() => {
      window.clearTimeout(timeout);
      if (active) setFailed(true);
    });
    return () => { active = false; window.clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [getCover, retry, shouldLoad, template.installedVersion, template.manifest.id, template.manifest.version]);
  if (!shouldLoad) return <div ref={placeholderRef} data-template-cover-lazy className={cn("h-full w-full bg-muted", className)} />;
  if (failed) {
    return (
      <div className={cn("grid h-full w-full place-items-center bg-muted p-4 text-center", className)}>
        <div className="max-w-full">
          <p className="truncate text-xs font-medium text-foreground">{template.manifest.title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("template_market.cover_failed")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3 h-7 rounded-lg px-2 text-[11px]" onClick={(event) => { event.stopPropagation(); setRetry((value) => value + 1); }}>
            {t("template_market.retry_cover")}
          </Button>
        </div>
      </div>
    );
  }
  return src ? <img src={src} alt={alt} decoding="async" className={cn("h-full w-full object-cover", className)} /> : <div className={cn("h-full w-full animate-pulse bg-muted", className)} />;
}

export type TemplateMarketDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateCatalogItem[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  getCover: TemplateCoverLoader;
  enterprise: EnterpriseConnection | null;
  resourceScope: WorkContextId;
  enterpriseResources: EnterpriseResource[];
  onResourceScopeChange: (scope: WorkContextId) => void;
  onInstallEnterprise: (resource: EnterpriseResource) => void;
  onRefresh: () => void;
  onUse: (template: TemplateCatalogItem) => void;
  onInstall: (templateId: string) => void;
  onImport: (file: File) => Promise<boolean>;
};

export function TemplateMarketDialog(props: TemplateMarketDialogProps) {
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");
  const [style, setStyle] = React.useState<TemplateStyle | "all">("all");
  const [view, setView] = React.useState<TemplateMarketView>("explore");
  const [myCollection, setMyCollection] = React.useState<MyTemplateCollection>("all");
  const [query, setQuery] = React.useState("");
  const [favoriteIds, setFavoriteIds] = React.useState(readFavoriteTemplateIds);
  const [pendingImport, setPendingImport] = React.useState<File | null>(null);
  const [previewSelection, setPreviewSelection] = React.useState<TemplatePreviewSelection | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const enterpriseMode = props.resourceScope !== "personal";

  React.useEffect(() => { if (props.open) props.onRefresh(); }, [props.open, props.onRefresh]);
  const styleOptions = React.useMemo(() => {
    const available = new Set(props.templates.map((item) => item.manifest.style));
    return STYLE_ORDER.filter((id) => available.has(id)).map((id) => ({ id, label: templateStyleLabel(id) }));
  }, [props.templates]);

  React.useEffect(() => {
    if (style !== "all" && !styleOptions.some((option) => option.id === style)) setStyle("all");
  }, [style, styleOptions]);

  const visible = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.templates.filter((template) => {
      if (!templateMatches({ template, category, style, query: normalized })) return false;
      if (view === "explore") return template.sourceType !== "local";
      if (myCollection === "favorites") return favoriteIds.has(template.manifest.id);
      if (myCollection === "mine") return template.sourceType === "local";
      return template.sourceType === "local" || favoriteIds.has(template.manifest.id);
    });
  }, [category, favoriteIds, myCollection, props.templates, query, style, view]);
  const visibleEnterpriseResources = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.enterpriseResources.filter((resource) => enterpriseResourceMatches({ resource, category, query: normalized }));
  }, [category, props.enterpriseResources, query]);
  const enterpriseTemplateInstallations = React.useMemo(() => {
    const templatesById = new Map(props.templates.map((template) => [template.manifest.id, template]));
    const installations = new Map<string, TemplateCatalogItem>();
    for (const resource of props.enterpriseResources) {
      const installed = (resource.manifestId ? templatesById.get(resource.manifestId) : undefined)
        ?? templatesById.get(resource.slug);
      if (installed) installations.set(resource.id, installed);
    }
    return installations;
  }, [props.enterpriseResources, props.templates]);
  const previewTemplate = previewSelection?.template ?? null;
  const previewEnterpriseResource = previewSelection?.enterpriseResourceId
    ? props.enterpriseResources.find((resource) => resource.id === previewSelection.enterpriseResourceId)
    : undefined;
  const previewEnterpriseCurrent = Boolean(
    previewEnterpriseResource?.latestVersion
      && previewEnterpriseResource.latestVersion.version === previewTemplate?.installedVersion,
  );
  const previewPrimaryLabel = previewEnterpriseResource
    ? previewEnterpriseCurrent ? t("template_market.use_template") : t("template_market.update_template")
    : previewTemplate?.updateAvailable
      ? t("template_market.update_template")
      : previewTemplate?.installed ? t("template_market.use_template") : t("template_market.install_template");
  const runPreviewPrimaryAction = () => {
    if (!previewTemplate) return;
    const template = previewTemplate;
    const enterpriseResource = previewEnterpriseResource;
    setPreviewSelection(null);
    if (enterpriseResource) {
      if (previewEnterpriseCurrent) props.onUse(template);
      else props.onInstallEnterprise(enterpriseResource);
    } else if (template.updateAvailable || !template.installed) {
      props.onInstall(template.manifest.id);
    } else {
      props.onUse(template);
    }
  };
  const toggleFavorite = React.useCallback((templateId: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      writeFavoriteTemplateIds(next);
      return next;
    });
  }, []);
  const selectView = (nextView: TemplateMarketView) => {
    setView(nextView);
    if (nextView === "my") {
      setCategory("all");
      setStyle("all");
      if (enterpriseMode) props.onResourceScopeChange("personal");
    }
  };
  const moreCategoryActive = MORE_CATEGORIES.some((item) => item.id === category);

  return (
    <>
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton className="flex h-[min(650px,calc(100dvh-160px))] min-h-[420px] w-[min(960px,calc(100dvw-160px))] min-w-[640px] max-h-[calc(100dvh-32px)] max-w-[calc(100dvw-32px)] resize flex-col gap-0 overflow-hidden p-0 [&>[data-slot=dialog-close]]:top-[29px] max-[720px]:h-[calc(100dvh-32px)] max-[720px]:w-[calc(100%-32px)] max-[720px]:min-w-[320px]">
        <DialogHeader className="mt-[29px] w-full shrink-0 px-6 text-left">
          <DialogTitle className="font-['PingFang_SC',sans-serif] text-2xl font-semibold leading-8 tracking-normal text-foreground">{t("template_market.title")}</DialogTitle>
        </DialogHeader>

        <div className="mt-4 w-full shrink-0 px-6">
          <div className="flex h-9 items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4" role="tablist" aria-label={t("template_market.title")}>
              {TEMPLATE_MARKET_VIEWS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={view === item}
                  onClick={() => selectView(item)}
                  className={cn(
                    "h-9 rounded-lg px-3.5 font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                    view === item ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t(item === "explore" ? "template_market.explore" : "template_market.my_templates")}
                </button>
              ))}
            </div>
            <input ref={importRef} type="file" accept={TEMPLATE_PACKAGE_FILE_ACCEPT} className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setPendingImport(file); event.currentTarget.value = ""; }} />
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="sm" className="h-9 w-[90px] shrink-0 rounded-lg px-3.5 font-['PingFang_SC',sans-serif] text-[13px] font-medium shadow-none" disabled={props.busyId !== null || enterpriseMode} onClick={() => importRef.current?.click()} />}>
                <Download className="size-3.5" />{t("template_market.import")}
              </TooltipTrigger>
              <TooltipContent positionerClassName="z-[90]">{t("template_market.import_tooltip")}</TooltipContent>
            </Tooltip>
          </div>

          <div className="relative mt-4 w-full"><Search className="pointer-events-none absolute left-[17px] top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("template_market.search_placeholder")} className="h-9 w-full rounded-lg border-0 bg-muted/50 pl-[43px] pr-4 font-['PingFang_SC',sans-serif] text-xs font-medium text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring/20" /></div>

          <div className="mt-3 flex h-9 items-center gap-4 overflow-x-auto">
            {view === "explore" ? <div className="flex min-w-max items-center gap-4">
            <button type="button" onClick={() => setCategory("all")} className={cn("inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-[28px] bg-transparent px-2 font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[22px] transition-colors", category === "all" ? "bg-foreground text-background" : "text-foreground hover:bg-muted")}>{t("template_market.all_types")}</button>
            {PRIMARY_CATEGORIES.map(({ id, labelKey, icon: Icon }) => <button key={id} type="button" onClick={() => setCategory(id)} className={cn("inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[28px] bg-transparent px-2 font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[22px] transition-colors", category === id ? "bg-foreground text-background" : "text-foreground hover:bg-muted")}><Icon className="size-3.5" />{t(labelKey)}</button>)}
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={cn("inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[28px] bg-transparent px-2 font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[22px] transition-colors", moreCategoryActive ? "bg-foreground text-background" : "text-foreground hover:bg-muted")} />}>
                {t("template_market.more")}<ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" alignOffset={4} sideOffset={7} positionerClassName="z-[90]" className="w-[196px] min-w-[196px]">
                {MORE_CATEGORIES.map(({ id, labelKey, icon: Icon }) => <DropdownMenuItem key={id} className={cn("whitespace-nowrap font-['PingFang_SC',sans-serif] text-foreground", category === id && "bg-muted")} onClick={() => setCategory(id)}><Icon className="size-3.5" />{t(labelKey)}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            </div> : <>
            <div className="flex min-w-max items-center gap-2" role="tablist" aria-label={t("template_market.my_templates")}>
              {MY_TEMPLATE_COLLECTIONS.map((item) => <button key={item} type="button" role="tab" aria-selected={myCollection === item} onClick={() => setMyCollection(item)} className={cn("inline-flex h-7 items-center justify-center whitespace-nowrap rounded-[28px] bg-transparent px-4 font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[22px] transition-colors", myCollection === item ? "bg-foreground text-background" : "text-foreground hover:bg-muted")}>{t(`template_market.my_${item}`)}</button>)}
            </div>
            <DropdownMenu>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span className="font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[18px] text-foreground">{t("template_market.type_label")}</span>
                <DropdownMenuTrigger render={<button type="button" className="flex h-[34px] w-[132px] shrink-0 items-center justify-between rounded-lg bg-muted/50 py-2 pl-2 pr-4 font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[18px] text-foreground transition-colors hover:bg-muted" />}>
                  {category === "all" ? t("template_market.all") : t(CATEGORIES.find((item) => item.id === category)?.labelKey ?? "template_market.category.other")}<ChevronDown className="size-4" />
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="start" positionerClassName="z-[90]" className="min-w-52">
                <DropdownMenuItem onClick={() => setCategory("all")}>{category === "all" ? <Check className="size-3.5" /> : <span className="size-3.5" />}{t("template_market.all")}</DropdownMenuItem>
                {CATEGORIES.map(({ id, labelKey, icon: Icon }) => <DropdownMenuItem key={id} onClick={() => setCategory(id)}>{category === id ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}{t(labelKey)}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            </>}
            <DropdownMenu>
              <div className={cn("flex shrink-0 items-center gap-2", view === "explore" && "ml-auto")}>
                <span className="font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[18px] text-foreground">{t("template_market.style_label")}</span>
                <DropdownMenuTrigger render={<button type="button" className="flex h-[34px] w-[132px] shrink-0 items-center justify-between rounded-lg bg-muted/50 py-2 pl-2 pr-4 font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[18px] text-foreground transition-colors hover:bg-muted" />}>
                  {style === "all" ? t("template_market.all") : templateStyleLabel(style)}<ChevronDown className="size-4" />
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="end" positionerClassName="z-[90]" className="min-w-52">
                {props.enterprise ? <div className="px-1 pb-1"><WorkResourceScopeSwitch enterprise={props.enterprise} value={props.resourceScope} onChange={props.onResourceScopeChange} /></div> : null}
                <DropdownMenuItem onClick={() => setStyle("all")}>{style === "all" ? <Check className="size-3.5" /> : <span className="size-3.5" />}{t("template_market.all")}</DropdownMenuItem>
                {styleOptions.map((option) => <DropdownMenuItem key={option.id} onClick={() => setStyle(option.id)}>{style === option.id ? <Check className="size-3.5" /> : <span className="size-3.5" />}{option.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {pendingImport ? <div className="mx-6 mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2"><Download className="size-4 text-foreground" /><span className="min-w-40 flex-1 truncate text-xs">{pendingImport.name} - {(pendingImport.size / 1024).toFixed(1)} KB</span><Button variant="ghost" size="sm" disabled={props.busyId !== null} onClick={() => setPendingImport(null)}>{t("common.cancel")}</Button><Button size="sm" className="rounded-lg" disabled={props.busyId !== null} onClick={async () => { if (await props.onImport(pendingImport)) setPendingImport(null); }}>{props.busyId === "import" ? <Loader2 className="size-3.5 animate-spin" /> : null}{t("template_market.install")}</Button></div> : null}

        <section className="mt-3 min-h-0 w-full flex-1 overflow-y-auto px-6 pb-6">
          {props.loading ? <div data-testid="template-catalog-loading" className="grid grid-cols-3 gap-4 max-[800px]:grid-cols-2 max-[540px]:grid-cols-1">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[227px] animate-pulse rounded-lg bg-muted" />)}</div> : props.error ? <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center"><p className="text-sm">{props.error}</p><Button variant="outline" size="sm" className="mt-3 rounded-lg" onClick={props.onRefresh}>{t("template_market.retry")}</Button></div> : enterpriseMode && view === "explore" ? (visibleEnterpriseResources.length ? <div className="grid grid-cols-3 gap-4 max-[800px]:grid-cols-2 max-[540px]:grid-cols-1">{visibleEnterpriseResources.map((resource) => {
            const installedTemplate = enterpriseTemplateInstallations.get(resource.id);
            return <EnterpriseTemplateCard key={resource.id} resource={resource} installedTemplate={installedTemplate} getCover={props.getCover} sourceLabel={props.enterprise?.shortName ?? resource.enterpriseCategory} busy={props.busyId === resource.id || props.busyId === "import"} disabled={props.busyId !== null} favorite={installedTemplate ? favoriteIds.has(installedTemplate.manifest.id) : false} onToggleFavorite={() => { if (installedTemplate) toggleFavorite(installedTemplate.manifest.id); }} onPreview={(template) => setPreviewSelection({ template, enterpriseResourceId: resource.id })} onInstall={() => props.onInstallEnterprise(resource)} onUse={() => { if (installedTemplate) props.onUse(installedTemplate); }} />;
          })}</div> : <div className="rounded-lg border border-dashed border-border p-10 text-center"><Building2 className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{t("enterprise_connection.enterprise_templates_empty")}</p></div>) : visible.length ? <div className="grid grid-cols-3 gap-4 max-[800px]:grid-cols-2 max-[540px]:grid-cols-1">{visible.map((template) => <TemplateCard key={template.manifest.id} template={template} getCover={props.getCover} busy={props.busyId !== null} favorite={favoriteIds.has(template.manifest.id)} onToggleFavorite={() => toggleFavorite(template.manifest.id)} onPreview={() => setPreviewSelection({ template })} onUse={() => props.onUse(template)} onInstall={() => props.onInstall(template.manifest.id)} />)}</div> : <div className="rounded-lg border border-dashed border-border p-10 text-center"><LayoutTemplate className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{t("template_market.no_match_title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("template_market.no_match_desc")}</p></div>}
        </section>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => { if (!open) setPreviewSelection(null); }}>
      <DialogContent showCloseButton className="max-w-[960px] gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        {previewTemplate ? <>
          <div className="aspect-video overflow-hidden bg-muted"><TemplateCover template={previewTemplate} getCover={props.getCover} alt={t("template_market.preview_alt", { title: previewTemplate.manifest.title })} eager /></div>
          <div className="relative z-10 flex flex-col gap-5 border-t border-border bg-popover px-6 pb-5 pt-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1"><div className="flex min-h-7 flex-wrap items-center gap-2"><DialogTitle className="text-lg">{previewTemplate.manifest.title}</DialogTitle>{isPptxCompatibleTemplate(previewTemplate.manifest) ? <Badge className="text-[10px]">{t("template_market.pptx_compatible")}</Badge> : null}<Badge variant="outline" className="text-[10px]">{t(CATEGORIES.find((item) => item.id === previewTemplate.manifest.category)?.labelKey ?? "template_market.category.other")}</Badge><Badge variant="outline" className="text-[10px]">{templateStyleLabel(previewTemplate.manifest.style)}</Badge></div><DialogDescription className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5">{previewTemplate.manifest.description}</DialogDescription><p className="mt-2 text-[10px] text-muted-foreground">{previewTemplate.manifest.source.name} / {previewTemplate.manifest.source.license}</p></div>
            <div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" className="rounded-xl" onClick={() => setPreviewSelection(null)}>{t("common.back")}</Button><Button size="sm" className="rounded-xl" disabled={props.busyId !== null || Boolean(previewEnterpriseResource && !previewEnterpriseResource.latestVersion)} onClick={runPreviewPrimaryAction}>{props.busyId === previewTemplate.manifest.id || props.busyId === previewEnterpriseResource?.id ? <Loader2 className="size-3.5 animate-spin" /> : null}{previewPrimaryLabel}</Button></div>
          </div>
        </> : null}
      </DialogContent>
    </Dialog>
    </>
  );
}

function EnterpriseTemplateCard({ resource, installedTemplate, getCover, sourceLabel, busy, disabled, favorite, onToggleFavorite, onPreview, onInstall, onUse }: { resource: EnterpriseResource; installedTemplate?: TemplateCatalogItem; getCover: TemplateCoverLoader; sourceLabel: string; busy: boolean; disabled: boolean; favorite: boolean; onToggleFavorite: () => void; onPreview: (template: TemplateCatalogItem) => void; onInstall: () => void; onUse: () => void }) {
  const currentVersionInstalled = Boolean(installedTemplate && resource.latestVersion?.version === installedTemplate.installedVersion);
  const action = currentVersionInstalled ? onUse : onInstall;
  const label = currentVersionInstalled
    ? t("template_market.use")
    : installedTemplate ? t("template_market.update") : t("enterprise_connection.install_from_enterprise");
  if (installedTemplate) {
    return <TemplateCard template={installedTemplate} getCover={getCover} busy={disabled} favorite={favorite} onToggleFavorite={onToggleFavorite} onPreview={() => onPreview(installedTemplate)} onUse={onUse} onInstall={onInstall} primaryAction={action} primaryLabel={label} sourceLabel={sourceLabel} />;
  }
  return <article className="overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="size-4" /></div><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{resource.name}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{resource.description}</p></div></div><div className="mt-4 flex items-center justify-between gap-2"><div className="flex min-w-0 gap-1.5"><Badge variant="outline" className="truncate text-[10px]">{resource.enterpriseCategory}</Badge>{resource.latestVersion ? <Badge variant="secondary" className="text-[10px]">v{resource.latestVersion.version}</Badge> : null}</div><Button variant={currentVersionInstalled ? "outline" : "default"} size="sm" className="h-7 rounded-lg px-2.5 text-[11px]" disabled={disabled || !resource.latestVersion} onClick={action}>{busy ? <Loader2 className="size-3 animate-spin" /> : null}{label}</Button></div></article>;
}

function TemplateCard({ template, getCover, busy, favorite, onToggleFavorite, onPreview, onUse, onInstall, primaryAction: primaryActionOverride, primaryLabel: primaryLabelOverride, sourceLabel }: { template: TemplateCatalogItem; getCover: TemplateCoverLoader; busy: boolean; favorite: boolean; onToggleFavorite: () => void; onPreview: () => void; onUse: () => void; onInstall: () => void; primaryAction?: () => void; primaryLabel?: string; sourceLabel?: string }) {
  const primaryAction = primaryActionOverride ?? (template.updateAvailable ? onInstall : template.installed ? onUse : onInstall);
  const primaryLabel = primaryLabelOverride ?? (template.updateAvailable ? t("template_market.update") : template.installed ? t("template_market.use") : t("template_market.install"));
  return (
    <article className="flex h-[227px] min-w-0 flex-col gap-3 overflow-hidden rounded-lg border-2 border-transparent bg-muted/50 pb-4 transition-colors duration-150 hover:border-[var(--project-dialog-accent)]">
      <Tooltip>
        <TooltipTrigger render={<button type="button" className="relative block h-[137px] w-full shrink-0 overflow-hidden rounded-lg bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30" onClick={onPreview} aria-label={t("template_market.preview_aria", { title: template.manifest.title })} />}>
          <TemplateCover template={template} getCover={getCover} alt={t("template_market.cover_alt", { title: template.manifest.title })} />
          <span className="absolute bottom-4 right-2 rounded-[18px] bg-muted-foreground px-2 py-0.5 font-['PingFang_SC',sans-serif] text-xs font-medium leading-[18px] text-background">{templateStyleLabel(template.manifest.style)}</span>
        </TooltipTrigger>
        <TooltipContent positionerClassName="z-[90]">{t("template_market.format_tooltip", { format: templateFormatLabel(template) })}</TooltipContent>
      </Tooltip>
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <div className="flex h-5 min-w-0 items-center justify-between gap-2">
          <h3 className="truncate font-['PingFang_SC',sans-serif] text-sm font-bold leading-5 text-foreground">{template.manifest.title}</h3>
          <span className="max-w-24 shrink-0 truncate font-['PingFang_SC',sans-serif] text-xs font-medium leading-[18px] text-primary">{sourceLabel ?? t(template.sourceType === "local" ? "template_market.mine_badge" : "template_market.official_badge")}</span>
        </div>
        <div className="mt-3 flex h-7 items-center justify-between gap-3">
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="sm" className={cn("h-7 rounded-lg px-2 font-['PingFang_SC',sans-serif] text-[13px] font-semibold leading-[18px]", favorite ? "text-foreground" : "text-muted-foreground")} aria-pressed={favorite} aria-label={t(favorite ? "template_market.remove_favorite" : "template_market.add_favorite", { title: template.manifest.title })} onClick={onToggleFavorite} />}>
              <Star className={cn("size-3.5", favorite && "fill-current")} />{t("template_market.favorite")}
            </TooltipTrigger>
            <TooltipContent positionerClassName="z-[90]">{t(favorite ? "template_market.remove_from_favorites" : "template_market.add_to_favorites")}</TooltipContent>
          </Tooltip>
          <Button size="sm" className="h-7 rounded-lg px-2 font-['PingFang_SC',sans-serif] text-[13px] font-semibold leading-[18px] shadow-none" disabled={busy} onClick={primaryAction}>{busy ? <Loader2 className="size-3 animate-spin" /> : null}{primaryLabel}</Button>
        </div>
      </div>
    </article>
  );
}
