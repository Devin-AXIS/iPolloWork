/** @jsxImportSource react */
import * as React from "react";
import {
  BookImage,
  Building2,
  Check,
  ChartBarBig,
  ChevronDown,
  Clapperboard,
  Cloud,
  Download,
  FileImage,
  Folders,
  Globe2,
  IdCard,
  Loader2,
  PictureInPicture2,
  Plus,
  Presentation,
  Search,
  Star,
  type LucideIcon,
} from "lucide-react";
import {
  matchesTemplateFilters,
  TEMPLATE_PACKAGE_FILE_ACCEPT,
  isPptxCompatibleTemplate,
  type TemplateCatalogItem,
  type TemplateCategory,
  type TemplateStyle,
  type TemplateTopicFilter,
} from "@ipollowork/types/templates";

import { Alert, AlertDescription, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CardActionsMenu } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonStyleScopeProvider } from "@/components/ui/button";
import { TemplateIcon } from "@/components/template-icon";
import { TemplateCatalogFilters } from "@/components/template-catalog-filters";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, translationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { EnterpriseResource } from "@/app/lib/enterprise-connections";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { readRemoteTemplateCard } from "@/app/lib/enterprise-connections";
import { EnterpriseResourceStatus, EnterpriseResourceMenuItems, EnterpriseResourceSubmissionDialog, type EnterpriseResourceSubmission, EnterpriseResourceActionDialog, type EnterpriseResourceAction } from "@/react-app/domains/enterprise";

type TemplateCoverLoader = (templateId: string) => Promise<{ data: ArrayBuffer; contentType?: string | null }>;
type TemplatePreviewSelection = { template: TemplateCatalogItem; remoteResourceId?: string; coverDataUrl?: string };

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

const templateStyleLabel = (style: TemplateStyle) => t(translationKey("template_market.style.", style));
const TEMPLATE_COVER_TIMEOUT_MS = 12_000;
const TEMPLATE_COVER_ROOT_MARGIN = "480px 0px";
const FAVORITE_TEMPLATE_IDS_STORAGE_KEY = "ipollowork.template-favorites.v1";

type TemplateMarketView = "explore" | "my";
type MyTemplateCollection = "all" | "favorites" | "mine";
export type TemplateCatalogSource = "builtin" | "cloud" | "enterprise";

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

export function cloudResourceMatches(input: {
  resource: EnterpriseResource;
  installed?: TemplateCatalogItem;
  category: TemplateCategory | "all";
  style: TemplateStyle | "all";
  topic: TemplateTopicFilter;
  query: string;
}) {
  const { resource, installed, category, style, topic, query } = input;
  const normalized = query.trim().toLowerCase();
  const metadataMatches = !normalized || [resource.name, resource.description, resource.category, resource.enterpriseCategory]
    .join(" ").toLowerCase().includes(normalized);
  if (installed) {
    return matchesTemplateFilters(installed.manifest, { category, style, topic })
      && (metadataMatches || matchesTemplateFilters(installed.manifest, { query: normalized }));
  }
  if (style !== "all" || (topic !== "all" && topic !== "unclassified")) return false;
  if (category !== "all" && resource.category !== category) return false;
  return metadataMatches;
}

function TemplateCover({ template, getCover, className, alt = "", eager = false }: { template: TemplateCatalogItem; getCover: TemplateCoverLoader; className?: string; alt?: string; eager?: boolean }) {
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = React.useState(eager);
  const [src, setSrc] = React.useState("");
  const [failed, setFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const loadCover = React.useEffectEvent((id: string) => getCover(id));

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
    void loadCover(template.manifest.id).then(({ data, contentType }) => {
      if (!active) return;
      window.clearTimeout(timeout);
      setFailed(false);
      objectUrl = URL.createObjectURL(new Blob([data], { type: contentType ?? "image/svg+xml" }));
      setSrc(objectUrl);
    }).catch(() => {
      window.clearTimeout(timeout);
      if (active) setFailed(true);
    });
    return () => { active = false; window.clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [retry, shouldLoad, template.installedVersion, template.manifest.id, template.manifest.version]);
  if (!shouldLoad) return <div ref={placeholderRef} data-template-cover-lazy className={cn("h-full w-full bg-muted", className)} />;
  if (failed) {
    return (
      <Alert variant="destructive" className={cn("flex h-full w-full flex-col items-center justify-center rounded-none text-center", className)}>
        <AlertTitle className="max-w-full truncate">{template.manifest.title}</AlertTitle>
        <AlertDescription>{t("template_market.cover_failed")}</AlertDescription>
        <AlertAction><Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); setRetry((value) => value + 1); }}>{t("template_market.retry_cover")}</Button></AlertAction>
      </Alert>
    );
  }
  return src ? <img src={src} alt={alt} decoding="async" onError={() => setFailed(true)} className={cn("h-full w-full object-cover", className)} /> : <Skeleton aria-label={t("settings.marketplace.loading")} className={cn("h-full w-full rounded-none", className)} />;
}

export type TemplateMarketDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateCatalogItem[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  getCover: TemplateCoverLoader;
  remoteResources: EnterpriseResource[];
  cloudAvailable: boolean;
  enterpriseAvailable: boolean;
  enterpriseConnection?: EnterpriseConnection | null;
  source: TemplateCatalogSource;
  onSelectSource: (source: TemplateCatalogSource) => void;
  onInstallRemote: (resource: EnterpriseResource) => void;
  onRefresh: () => void;
  onLoadMore?: () => void;
  exportPackage?: (template: TemplateCatalogItem) => Promise<File>;
  onUse: (template: TemplateCatalogItem) => void;
  onCustom: (category: TemplateCategory) => void;
  onInstall: (templateId: string) => void;
  onImport: (file: File) => Promise<boolean>;
};

export function TemplateMarketDialog(props: TemplateMarketDialogProps) {
  const [submission, setSubmission] = React.useState<EnterpriseResourceSubmission | null>(null);
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");
  const [style, setStyle] = React.useState<TemplateStyle | "all">("all");
  const [topic, setTopic] = React.useState<TemplateTopicFilter>("all");
  const [resourceAction, setResourceAction] = React.useState<EnterpriseResourceAction | null>(null);
  React.useEffect(() => { setResourceAction(null); setSubmission(null); }, [props.enterpriseConnection?.id, props.enterpriseConnection?.membership.id, props.source, props.open]);
  const [view, setView] = React.useState<TemplateMarketView>("explore");
  const [myCollection, setMyCollection] = React.useState<MyTemplateCollection>("all");
  const [query, setQuery] = React.useState("");
  const [favoriteIds, setFavoriteIds] = React.useState(readFavoriteTemplateIds);
  const [pendingImport, setPendingImport] = React.useState<File | null>(null);
  const [previewSelection, setPreviewSelection] = React.useState<TemplatePreviewSelection | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const remoteCatalogMode = props.source !== "builtin";
  const enterpriseLabel = props.enterpriseConnection?.name ?? t("enterprise_connection.enterprise");
  const remoteSourceLabel = props.source === "enterprise"
    ? enterpriseLabel
    : t("enterprise_connection.cloud");

  const refreshCatalog = React.useEffectEvent(() => props.onRefresh());
  React.useEffect(() => { if (props.open) refreshCatalog(); }, [props.open, props.source, props.enterpriseConnection?.id, props.enterpriseConnection?.origin, props.enterpriseConnection?.membership.id, props.enterpriseConnection?.session.token]);
  React.useEffect(() => {
    if (!props.open) setTopic("all");
  }, [props.open]);

  const visible = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.templates.filter((template) => {
      if (!matchesTemplateFilters(template.manifest, { category, style, topic, query: normalized })) return false;
      if (view === "explore") return template.sourceType !== "local";
      if (myCollection === "favorites") return favoriteIds.has(template.manifest.id);
      if (myCollection === "mine") return template.sourceType === "local";
      return template.sourceType === "local" || favoriteIds.has(template.manifest.id);
    });
  }, [category, favoriteIds, myCollection, props.templates, query, style, topic, view]);
  const myTemplatesEmpty = !props.templates.some(
    (template) => template.sourceType === "local" || favoriteIds.has(template.manifest.id),
  );
  const remoteTemplateInstallations = React.useMemo(() => {
    const templatesById = new Map(props.templates.map((template) => [template.manifest.id, template]));
    const installations = new Map<string, TemplateCatalogItem>();
    for (const resource of props.remoteResources) {
      const installed = (resource.manifestId ? templatesById.get(resource.manifestId) : undefined)
        ?? templatesById.get(resource.slug);
      if (installed) installations.set(resource.id, installed);
    }
    return installations;
  }, [props.remoteResources, props.templates]);
  const visibleRemoteResources = React.useMemo(() => {
    return props.remoteResources.filter((resource) => cloudResourceMatches({
      resource,
      installed: remoteTemplateInstallations.get(resource.id),
      category,
      style,
      topic,
      query,
    }));
  }, [category, props.remoteResources, query, remoteTemplateInstallations, style, topic]);
  const previewTemplate = previewSelection?.template ?? null;
  const previewRemoteResource = previewSelection?.remoteResourceId
    ? props.remoteResources.find((resource) => resource.id === previewSelection.remoteResourceId)
    : undefined;
  const previewRemoteCurrent = Boolean(
    previewRemoteResource?.latestVersion
      && previewRemoteResource.latestVersion.version === previewTemplate?.installedVersion,
  );
  const previewPrimaryLabel = previewRemoteResource
    ? previewRemoteCurrent ? t("template_market.use_template") : t(previewTemplate?.installed ? "template_market.update_template" : "template_market.install_template")
    : previewTemplate?.updateAvailable
      ? t("template_market.update_template")
      : previewTemplate?.installed ? t("template_market.use_template") : t("template_market.install_template");
  const runPreviewPrimaryAction = () => {
    if (!previewTemplate) return;
    const template = previewTemplate;
    const remoteResource = previewRemoteResource;
    setPreviewSelection(null);
    if (remoteResource) {
      if (previewRemoteCurrent) props.onUse(template);
      else props.onInstallRemote(remoteResource);
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
    setTopic("all");
    if (nextView === "my") {
      setCategory("all");
      setStyle("all");
      if (remoteCatalogMode) props.onSelectSource("builtin");
    }
  };
  const exploreTemplates = () => {
    setView("explore");
    setTopic("all");
    setCategory("all");
    setStyle("all");
    setQuery("");
  };
  const catalogTab = view === "my" ? "my" : props.source;
  const moreCategoryActive = MORE_CATEGORIES.some((item) => item.id === category);

  return (
    <>
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton className="flex h-[min(650px,calc(100dvh-160px))] min-h-[420px] w-[min(960px,calc(100dvw-160px))] min-w-[640px] max-h-[calc(100dvh-32px)] max-w-[calc(100dvw-32px)] resize flex-col gap-0 overflow-hidden p-0 max-[720px]:h-[calc(100dvh-32px)] max-[720px]:w-[calc(100%-32px)] max-[720px]:min-w-[320px]">
        <DialogHeader className="mt-4 w-full shrink-0 px-6 text-left">
          <DialogTitle>{t("template_market.title")}</DialogTitle>
        </DialogHeader>

        <Tabs value={catalogTab} onValueChange={(value) => { if (value === "my") selectView("my"); else if (value === "builtin" || value === "cloud" || value === "enterprise") { selectView("explore"); props.onSelectSource(value); } }} className="min-h-0 flex-1 gap-0">
        <div className="mt-4 w-full shrink-0 px-6">
          <div className="flex min-h-9 flex-wrap items-center gap-3">
            <TabsList className="min-w-0 max-w-full shrink-0" aria-label={t("template_market.title")}>
              <TabsTrigger value="my" className="flex-none shrink-0">{t("template_market.my_tab")}</TabsTrigger>
              <TabsTrigger value="builtin" className="flex-none shrink-0">{t("template_market.source_builtin")}</TabsTrigger>
              {props.cloudAvailable ? <TabsTrigger value="cloud" className="flex-none shrink-0">{t("enterprise_connection.cloud")}</TabsTrigger> : null}
              {props.enterpriseAvailable ? <TabsTrigger value="enterprise" className="min-w-0 flex-initial" title={enterpriseLabel}><span className="max-w-48 truncate">{enterpriseLabel}</span></TabsTrigger> : null}
            </TabsList>
            <input ref={importRef} type="file" accept={TEMPLATE_PACKAGE_FILE_ACCEPT} className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setPendingImport(file); event.currentTarget.value = ""; }} />
            <ButtonStyleScopeProvider value="settings" flat><div role="group" aria-label="模板操作" className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              className="shadow-none"
              disabled={props.busyId !== null || remoteCatalogMode}
              onClick={() => props.onCustom(category === "all" ? "slides" : category)}
            >
              <Plus className="size-3.5" />{t("template_market.custom_title")}
            </Button>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" className="w-[90px] shadow-none" disabled={props.busyId !== null || remoteCatalogMode} onClick={() => importRef.current?.click()} />}>
                <Download className="size-3.5" />{t("template_market.import")}
              </TooltipTrigger>
              <TooltipContent positionerClassName="z-[90]">{t("template_market.import_tooltip")}</TooltipContent>
            </Tooltip>
            </div></ButtonStyleScopeProvider>
          </div>
        </div>
        <TabsContent value={catalogTab} className="flex min-h-0 flex-1 flex-col">
        <div className="w-full shrink-0 px-6">
          <InputGroup className="mt-4"><InputGroupAddon><Search aria-hidden="true" className="size-4" /></InputGroupAddon><InputGroupInput value={query} onChange={(event) => setQuery(event.currentTarget.value)} aria-label={t("template_market.search_placeholder")} placeholder={t("template_market.search_placeholder")} /></InputGroup>

          <div className="mt-2 flex h-9 items-center gap-4 overflow-x-auto">
            {view === "explore" ? <div className="flex min-w-max items-center gap-4">
            <Button type="button" size="sm" variant={category === "all" ? "secondary" : "ghost"} aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t("template_market.all_types")}</Button>
            {PRIMARY_CATEGORIES.map(({ id, labelKey, icon: Icon }) => <Button key={id} type="button" size="sm" variant={category === id ? "secondary" : "ghost"} aria-pressed={category === id} onClick={() => setCategory(id)}><Icon className="size-3.5" />{t(labelKey)}</Button>)}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" size="sm" variant={moreCategoryActive ? "secondary" : "ghost"} aria-pressed={moreCategoryActive} />}>
                {t("template_market.more")}<ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" alignOffset={4} sideOffset={7} positionerClassName="z-[90]" className="w-[196px] min-w-[196px]">
                {MORE_CATEGORIES.map(({ id, labelKey, icon: Icon }) => <DropdownMenuItem key={id} className={cn("whitespace-nowrap font-['PingFang_SC',sans-serif] text-foreground", category === id && "bg-muted")} onClick={() => setCategory(id)}><Icon className="size-3.5" />{t(labelKey)}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            </div> : <>
            <div role="group" className="flex min-w-max gap-1" aria-label={t("template_market.my_templates")}>
              {MY_TEMPLATE_COLLECTIONS.map((item) => <Button key={item} size="sm" variant={myCollection === item ? "secondary" : "ghost"} aria-pressed={myCollection === item} onClick={() => setMyCollection(item)}>{t(translationKey("template_market.my_", item))}</Button>)}
            </div>
            <DropdownMenu>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span className="font-['PingFang_SC',sans-serif] text-[13px] font-medium leading-[18px] text-foreground">{t("template_market.type_label")}</span>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="w-[132px] justify-between" />}>
                  {category === "all" ? t("template_market.all") : t(CATEGORIES.find((item) => item.id === category)?.labelKey ?? "template_market.category.other")}<ChevronDown className="size-4" />
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="start" positionerClassName="z-[90]" className="min-w-52">
                <DropdownMenuItem onClick={() => setCategory("all")}>{category === "all" ? <Check className="size-3.5" /> : <span className="size-3.5" />}{t("template_market.all")}</DropdownMenuItem>
                {CATEGORIES.map(({ id, labelKey, icon: Icon }) => <DropdownMenuItem key={id} onClick={() => setCategory(id)}>{category === id ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}{t(labelKey)}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            </>}
            <div className={cn("flex shrink-0 items-center gap-4", view === "explore" && "ml-auto")}>
              <TemplateCatalogFilters
                templates={props.templates}
                category={category}
                style={style}
                topic={topic}
                onStyleChange={setStyle}
                onTopicChange={setTopic}
              />
            </div>
          </div>
        </div>

        {pendingImport ? <div className="mx-6 mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2"><Download className="size-4 text-foreground" /><span className="min-w-40 flex-1 truncate text-xs">{pendingImport.name} - {(pendingImport.size / 1024).toFixed(1)} KB</span><Button variant="ghost" size="sm" disabled={props.busyId !== null} onClick={() => setPendingImport(null)}>{t("common.cancel")}</Button><Button size="sm" className="rounded-lg" disabled={props.busyId !== null} onClick={async () => { if (await props.onImport(pendingImport)) setPendingImport(null); }}>{props.busyId === "import" ? <Loader2 className="size-3.5 animate-spin" /> : null}{t("template_market.install")}</Button></div> : null}

        <div className="mt-3 min-h-0 w-full flex-1 overflow-y-auto [scrollbar-gutter:stable] px-6 pb-6">
          {props.loading && !props.templates.length && !props.remoteResources.length ? <div data-testid="template-catalog-loading" role="status" aria-label={t("settings.marketplace.loading")} className="grid grid-cols-3 gap-4 max-[800px]:grid-cols-2 max-[540px]:grid-cols-1">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-[227px] rounded-lg" />)}</div> : props.error ? <Alert variant="destructive"><AlertDescription>{props.error}</AlertDescription><AlertAction><Button variant="outline" size="sm" onClick={props.onRefresh}>{t("template_market.retry")}</Button></AlertAction></Alert> : remoteCatalogMode && view === "explore" ? (visibleRemoteResources.length ? <div className="grid grid-cols-3 gap-4 max-[800px]:grid-cols-2 max-[540px]:grid-cols-1">{visibleRemoteResources.map((resource) => {
            const installedTemplate = remoteTemplateInstallations.get(resource.id);
            return <RemoteTemplateCard key={`${props.source}:${props.enterpriseConnection?.id}:${resource.id}:${resource.latestVersion?.digest}`} resource={resource} installedTemplate={installedTemplate} getCover={props.getCover} busy={props.busyId === resource.id || props.busyId === "import"} disabled={props.busyId !== null} favorite={favoriteIds.has(resource.manifestId ?? resource.slug)} connection={props.source === "enterprise" ? props.enterpriseConnection ?? undefined : undefined} source={props.source} sourceLabel={remoteSourceLabel} onManage={setResourceAction} onToggleFavorite={toggleFavorite} onPreview={(template, coverDataUrl) => setPreviewSelection({ template, remoteResourceId: resource.id, coverDataUrl })} onInstall={() => props.onInstallRemote(resource)} onUse={() => { if (installedTemplate) props.onUse(installedTemplate); }} />;
          })}</div> : <Empty><EmptyMedia variant="icon">{props.source === "enterprise" ? <Building2 /> : <Cloud />}</EmptyMedia><EmptyDescription>{t(props.source === "enterprise" ? "enterprise_connection.enterprise_templates_empty" : "enterprise_connection.cloud_templates_empty")}</EmptyDescription>{query || category !== "all" || style !== "all" || topic !== "all" ? <Button variant="outline" size="sm" onClick={exploreTemplates}>{t("help.clear_search")}</Button> : null}</Empty>) : visible.length ? <div className="grid grid-cols-3 gap-4 max-[800px]:grid-cols-2 max-[540px]:grid-cols-1">{visible.map((template) => <TemplateCard key={template.manifest.id} template={template} getCover={props.getCover} onSubmit={view === "my" && template.sourceType === "local" && template.installed && props.enterpriseConnection?.features?.templatePublishing && props.exportPackage ? () => {
            const exportPackage = props.exportPackage;
            if (exportPackage) setSubmission({ name: template.manifest.title, prepareFile: () => exportPackage(template) });
          } : undefined} busy={props.busyId !== null} favorite={favoriteIds.has(template.manifest.id)} onToggleFavorite={() => toggleFavorite(template.manifest.id)} onPreview={() => setPreviewSelection({ template })} onUse={() => props.onUse(template)} onInstall={() => props.onInstall(template.manifest.id)} />)}</div> : view === "my" && myCollection === "all" && myTemplatesEmpty ? <Empty><EmptyMedia variant="icon"><TemplateIcon /></EmptyMedia><EmptyTitle>{t("template_market.my_empty_title")}</EmptyTitle><Button type="button" size="sm" onClick={exploreTemplates}>{t("template_market.explore_templates")}</Button></Empty> : <Empty><EmptyMedia variant="icon"><TemplateIcon /></EmptyMedia><EmptyTitle>{t("template_market.no_match_title")}</EmptyTitle><EmptyDescription>{t("template_market.no_match_desc")}</EmptyDescription><Button variant="outline" size="sm" onClick={() => { setQuery(""); setCategory("all"); setStyle("all"); setTopic("all"); }}>{t("help.clear_search")}</Button></Empty>}
          {remoteCatalogMode && props.onLoadMore ? <Button variant="outline" className="mt-4" disabled={props.loading} onClick={props.onLoadMore}>加载更多模板</Button> : null}
        </div>
        </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
    {props.enterpriseConnection && submission ? <EnterpriseResourceSubmissionDialog key={`${props.enterpriseConnection.id}:${props.enterpriseConnection.membership.id}`} connection={props.enterpriseConnection} type="template" submission={submission} onClose={() => setSubmission(null)} /> : null}
    {props.enterpriseConnection && resourceAction ? <EnterpriseResourceActionDialog connection={props.enterpriseConnection} action={resourceAction} onClose={() => setResourceAction(null)} onChanged={props.onRefresh} /> : null}
    <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => { if (!open) setPreviewSelection(null); }}>
      <DialogContent showCloseButton className="max-w-[960px] gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        {previewTemplate ? <>
          <div className="aspect-video overflow-hidden bg-muted">{previewSelection?.coverDataUrl ? <img src={previewSelection.coverDataUrl} alt={t("template_market.preview_alt", { title: previewTemplate.manifest.title })} className="h-full w-full object-cover" /> : <TemplateCover template={previewTemplate} getCover={props.getCover} alt={t("template_market.preview_alt", { title: previewTemplate.manifest.title })} eager />}</div>
          <div className="relative z-10 flex flex-col gap-5 border-t border-border bg-popover px-6 pb-5 pt-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1"><div className="flex min-h-7 flex-wrap items-center gap-2"><DialogTitle className="text-lg">{previewTemplate.manifest.title}</DialogTitle>{isPptxCompatibleTemplate(previewTemplate.manifest) ? <Badge className="text-[10px]">{t("template_market.pptx_compatible")}</Badge> : null}<Badge variant="outline" className="text-[10px]">{t(CATEGORIES.find((item) => item.id === previewTemplate.manifest.category)?.labelKey ?? "template_market.category.other")}</Badge><Badge variant="outline" className="text-[10px]">{templateStyleLabel(previewTemplate.manifest.style)}</Badge></div><DialogDescription className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5">{previewTemplate.manifest.description}</DialogDescription><p className="mt-2 text-[10px] text-muted-foreground">{previewTemplate.manifest.source.name} / {previewTemplate.manifest.source.license}</p></div>
            <div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" className="rounded-xl" onClick={() => setPreviewSelection(null)}>{t("common.back")}</Button><Button size="sm" className="rounded-xl" disabled={props.busyId !== null || Boolean(previewRemoteResource && (!previewRemoteResource.latestVersion || previewRemoteResource.lifecycle?.installable === false))} onClick={runPreviewPrimaryAction}>{props.busyId === previewTemplate.manifest.id || props.busyId === previewRemoteResource?.id ? <Loader2 className="size-3.5 animate-spin" /> : null}{previewPrimaryLabel}</Button></div>
          </div>
        </> : null}
      </DialogContent>
    </Dialog>
    </>
  );
}

function RemoteTemplateCard({ resource, installedTemplate, getCover, busy, disabled, favorite, connection, source, sourceLabel, onManage, onToggleFavorite, onPreview, onInstall, onUse }: { resource: EnterpriseResource; installedTemplate?: TemplateCatalogItem; getCover: TemplateCoverLoader; busy: boolean; disabled: boolean; favorite: boolean; connection?: EnterpriseConnection; source: TemplateCatalogSource; sourceLabel: string; onManage: (action: EnterpriseResourceAction) => void; onToggleFavorite: (templateId: string) => void; onPreview: (template: TemplateCatalogItem, coverDataUrl?: string) => void; onInstall: () => void; onUse: () => void }) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [preview, setPreview] = React.useState<Awaited<ReturnType<typeof readRemoteTemplateCard>> | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const loadPreview = React.useEffectEvent(() => readRemoteTemplateCard(resource, { connection }));
  React.useEffect(() => {
    if (!resource.latestVersion) return;
    let active = true;
    const load = () => {
      setFailed(false);
      setPreview(null);
      void loadPreview().then((card) => { if (active) setPreview(card); })
        .catch(() => { if (active) setFailed(true); });
    };
    const target = cardRef.current;
    if (!target || typeof IntersectionObserver === "undefined") { load(); return () => { active = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: TEMPLATE_COVER_ROOT_MARGIN });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); };
  }, [connection?.id, connection?.origin, connection?.membership.id, connection?.session.token, resource.id, resource.latestVersion?.digest, resource.latestVersion?.version, retry]);
  const currentVersionInstalled = Boolean(installedTemplate && resource.latestVersion?.version === installedTemplate.installedVersion);
  const action = currentVersionInstalled ? onUse : onInstall;
  const label = currentVersionInstalled
    ? t("template_market.use")
    : installedTemplate ? t("template_market.update") : t("enterprise_connection.install_from_enterprise");
  const template: TemplateCatalogItem | undefined = preview ? {
    manifest: preview.manifest, sourceType: "market", installed: Boolean(installedTemplate),
    installedVersion: installedTemplate?.installedVersion ?? null,
    updateAvailable: Boolean(installedTemplate && !currentVersionInstalled), verified: false,
  } : installedTemplate;
  const openPreview = () => { if (template) onPreview(template, preview?.coverDataUrl); };
  return <div ref={cardRef} className="min-w-0" data-testid="remote-template-card" data-source={source}>
    <TemplateCardFrame
      title={resource.name}
      style={template?.manifest.style}
      format={template ? templateFormatLabel(template) : undefined}
      sourceLabel={sourceLabel}
      status={resource.lifecycle ? <EnterpriseResourceStatus resource={resource} /> : undefined}
      cover={failed ? <Alert variant="destructive" className="flex h-full flex-col items-center justify-center rounded-none text-center">
        <AlertDescription>{t("template_market.cover_failed")}</AlertDescription>
        <AlertAction><Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>{t("template_market.retry_cover")}</Button></AlertAction>
      </Alert> : preview ? <img src={preview.coverDataUrl} alt={t("template_market.cover_alt", { title: resource.name })} decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        : installedTemplate ? <TemplateCover template={installedTemplate} getCover={getCover} />
        : <Skeleton aria-label={t("settings.marketplace.loading")} className="h-full w-full rounded-none" />}
      busy={busy}
      disabled={disabled || !resource.latestVersion || resource.lifecycle?.installable === false}
      favorite={favorite}
      favoriteDisabled={!template}
      onToggleFavorite={() => { if (template) onToggleFavorite(template.manifest.id); }}
      onPreview={template && !failed ? openPreview : undefined}
      previewTestId="remote-template-preview"
      primaryAction={action}
      primaryLabel={label}
      actions={source === "enterprise" ? <div data-slot="card-footer">
        <CardActionsMenu label={`${resource.name}的操作`} disabled={busy}>
          <DropdownMenuItem disabled={disabled || !resource.latestVersion || resource.lifecycle?.installable === false} onClick={action}>{label}</DropdownMenuItem>
          <DropdownMenuItem disabled={!template && !failed} onClick={() => { if (template) onPreview(template, preview?.coverDataUrl); else if (failed) setRetry((value) => value + 1); }}>{t(failed && !template ? "template_market.retry_cover" : "template_market.view")}</DropdownMenuItem>
          {connection ? <EnterpriseResourceMenuItems connection={connection} resource={resource} busy={disabled} onAction={onManage} /> : null}
        </CardActionsMenu>
      </div> : undefined}
    />
  </div>;
}

function TemplateCard({ template, getCover, busy, favorite, onToggleFavorite, onPreview, onUse, onInstall, primaryAction: primaryActionOverride, primaryLabel: primaryLabelOverride, sourceLabel, onSubmit }: { template: TemplateCatalogItem; getCover: TemplateCoverLoader; busy: boolean; favorite: boolean; onToggleFavorite: () => void; onPreview: () => void; onUse: () => void; onInstall: () => void; primaryAction?: () => void; primaryLabel?: string; sourceLabel?: string; onSubmit?: () => void }) {
  const primaryAction = primaryActionOverride ?? (template.updateAvailable ? onInstall : template.installed ? onUse : onInstall);
  const primaryLabel = primaryLabelOverride ?? (template.updateAvailable ? t("template_market.update") : template.installed ? t("template_market.use") : t("template_market.install"));
  return <TemplateCardFrame actions={onSubmit ? <CardActionsMenu label={`${template.manifest.title}的操作`} disabled={busy}><DropdownMenuItem onClick={primaryAction}>{primaryLabel}</DropdownMenuItem><DropdownMenuItem onClick={onSubmit}>投稿到企业</DropdownMenuItem></CardActionsMenu> : undefined} title={template.manifest.title} style={template.manifest.style} format={templateFormatLabel(template)} cover={<TemplateCover template={template} getCover={getCover} alt={t("template_market.cover_alt", { title: template.manifest.title })} />} busy={busy} disabled={busy} favorite={favorite} onToggleFavorite={onToggleFavorite} onPreview={onPreview} primaryAction={primaryAction} primaryLabel={primaryLabel} sourceLabel={sourceLabel ?? t(template.sourceType === "local" ? "template_market.mine_badge" : "template_market.official_badge")} />;
}

function TemplateCardFrame({ title, style, format, cover, busy, disabled, favorite, favoriteDisabled, onToggleFavorite, onPreview, primaryAction, primaryLabel, sourceLabel, actions, status, previewTestId }: { title: string; style?: TemplateStyle; format?: string; cover: React.ReactNode; busy: boolean; disabled: boolean; favorite: boolean; favoriteDisabled?: boolean; onToggleFavorite: () => void; onPreview?: () => void; primaryAction: () => void; primaryLabel: string; sourceLabel: string; actions?: React.ReactNode; status?: React.ReactNode; previewTestId?: string }) {
  return (
    <article className="flex min-h-[227px] min-w-0 flex-col gap-3 overflow-hidden rounded-lg border-2 border-transparent bg-muted/50 pb-4 transition-colors duration-150 hover:border-[var(--project-dialog-accent)]">
      <div className="relative block h-[137px] w-full shrink-0 overflow-hidden rounded-lg bg-muted" data-template-cover>
        {cover}
        <Tooltip>
          <TooltipTrigger render={<button type="button" data-testid={previewTestId} disabled={!onPreview} className="absolute inset-0 h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 disabled:pointer-events-none" onClick={onPreview} aria-label={t("template_market.preview_aria", { title })} />} />
          <TooltipContent positionerClassName="z-[90]">{format ? t("template_market.format_tooltip", { format }) : title}</TooltipContent>
        </Tooltip>
        {style ? <span className="pointer-events-none absolute bottom-4 right-2 rounded-[18px] bg-muted-foreground px-2 py-0.5 font-['PingFang_SC',sans-serif] text-xs font-medium leading-[18px] text-background">{templateStyleLabel(style)}</span> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <div className="flex h-5 min-w-0 items-center justify-between gap-2">
          <h3 title={title} className="truncate font-['PingFang_SC',sans-serif] text-sm font-bold leading-5 text-foreground">{title}</h3>
          <span className="max-w-24 shrink-0 truncate font-['PingFang_SC',sans-serif] text-xs font-medium leading-[18px] text-primary">{sourceLabel}</span>
        </div>
        {status}
        <div className="mt-3 flex h-7 items-center justify-between gap-3">
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="sm" className={cn("h-7 rounded-lg px-2 font-['PingFang_SC',sans-serif] text-[13px] font-semibold leading-[18px]", favorite ? "text-foreground" : "text-muted-foreground")} disabled={favoriteDisabled} aria-pressed={favorite} aria-label={t(favorite ? "template_market.remove_favorite" : "template_market.add_favorite", { title })} onClick={onToggleFavorite} />}>
              <Star className={cn("size-3.5", favorite && "fill-current")} />{t("template_market.favorite")}
            </TooltipTrigger>
            <TooltipContent positionerClassName="z-[90]">{t(favorite ? "template_market.remove_from_favorites" : "template_market.add_to_favorites")}</TooltipContent>
          </Tooltip>
          {actions ?? <Button size="sm" className="h-7 rounded-lg px-2 font-['PingFang_SC',sans-serif] text-[13px] font-semibold leading-[18px] shadow-none" disabled={disabled} onClick={primaryAction}>{busy ? <Loader2 className="size-3 animate-spin" /> : null}{primaryLabel}</Button>}
        </div>
      </div>
    </article>
  );
}
