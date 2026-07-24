/** @jsxImportSource react */
import * as React from "react";
import {
  AppWindow,
  BarChart3,
  Eye,
  FileChartColumnIncreasing,
  FileText,
  Film,
  FolderOpen,
  Globe2,
  Image,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  PanelsTopLeft,
  Presentation,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  TEMPLATE_STYLE_LABELS,
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

type TemplateCoverLoader = (templateId: string) => Promise<{ data: ArrayBuffer; contentType?: string | null }>;

type CategoryDefinition = {
  id: TemplateCategory;
  labelKey: string;
  detailKey: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const CATEGORIES: CategoryDefinition[] = [
  { id: "site", labelKey: "template_market.category.site", detailKey: "template_market.category.site_detail", Icon: Globe2 },
  { id: "video", labelKey: "template_market.category.video", detailKey: "template_market.category.video_detail", Icon: Film },
  { id: "app", labelKey: "template_market.category.app", detailKey: "template_market.category.app_detail", Icon: AppWindow },
  { id: "slides", labelKey: "template_market.category.slides", detailKey: "template_market.category.slides_detail", Icon: Presentation },
  { id: "poster", labelKey: "template_market.category.poster", detailKey: "template_market.category.poster_detail", Icon: Image },
  { id: "cards", labelKey: "template_market.category.cards", detailKey: "template_market.category.cards_detail", Icon: PanelsTopLeft },
  { id: "report", labelKey: "template_market.category.report", detailKey: "template_market.category.report_detail", Icon: FileChartColumnIncreasing },
  { id: "article", labelKey: "template_market.category.article", detailKey: "template_market.category.article_detail", Icon: FileText },
  { id: "other", labelKey: "template_market.category.other", detailKey: "template_market.category.other_detail", Icon: FolderOpen },
];

const STYLE_ORDER = Object.keys(TEMPLATE_STYLE_LABELS) as TemplateStyle[];
const templateStyleLabel = (style: TemplateStyle) => t(`template_market.style.${style}`);

function TemplateCover({ template, getCover, className, alt = "" }: { template: TemplateCatalogItem; getCover: TemplateCoverLoader; className?: string; alt?: string }) {
  const [src, setSrc] = React.useState("");
  React.useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSrc("");
    void getCover(template.manifest.id).then(({ data, contentType }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([data], { type: contentType ?? "image/svg+xml" }));
      setSrc(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [getCover, template.installedVersion, template.manifest.id, template.manifest.version]);
  return src ? <img src={src} alt={alt} className={cn("h-full w-full object-cover", className)} /> : <div className={cn("h-full w-full animate-pulse bg-muted", className)} />;
}

export type TemplateMarketDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateCatalogItem[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  getCover: TemplateCoverLoader;
  canSaveCurrent: boolean;
  currentSurface: "design" | "video" | null;
  currentCategory: TemplateCategory;
  onRefresh: () => void;
  onUse: (template: TemplateCatalogItem) => void;
  onInstall: (templateId: string) => void;
  onUninstall: (templateId: string) => void;
  onImport: (file: File) => Promise<boolean>;
  onSaveCurrent: (input: { title: string; category: TemplateCategory; style: TemplateStyle }) => void;
};

export function TemplateMarketDialog(props: TemplateMarketDialogProps) {
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");
  const [style, setStyle] = React.useState<TemplateStyle | "all">("all");
  const [source, setSource] = React.useState<"all" | "mine">("all");
  const [query, setQuery] = React.useState("");
  const [pendingImport, setPendingImport] = React.useState<File | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveTitle, setSaveTitle] = React.useState("");
  const [saveCategory, setSaveCategory] = React.useState<TemplateCategory>(props.currentCategory);
  const [previewTemplate, setPreviewTemplate] = React.useState<TemplateCatalogItem | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (props.open) props.onRefresh(); }, [props.open, props.onRefresh]);
  React.useEffect(() => { setSaveCategory(props.currentCategory); }, [props.currentCategory]);

  const saveCategories = props.currentSurface === "video" ? CATEGORIES.filter((entry) => entry.id === "video") : CATEGORIES.filter((entry) => entry.id !== "video");

  const styleOptions = React.useMemo(() => {
    const available = new Set(props.templates.map((item) => item.manifest.style));
    return STYLE_ORDER.filter((id) => available.has(id)).map((id) => ({ id, label: templateStyleLabel(id) }));
  }, [props.templates]);

  React.useEffect(() => {
    if (style !== "all" && !styleOptions.some((option) => option.id === style)) setStyle("all");
  }, [style, styleOptions]);

  const visible = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.templates.filter((item) => {
      if (category !== "all" && item.manifest.category !== category) return false;
      if (style !== "all" && item.manifest.style !== style) return false;
      if (source === "mine" && item.sourceType !== "local") return false;
      if (!normalized) return true;
      return [item.manifest.title, item.manifest.description, item.manifest.subcategory, item.manifest.style, ...item.manifest.tags]
        .join(" ").toLowerCase().includes(normalized);
    });
  }, [category, props.templates, query, source, style]);

  const submitSave = () => {
    const title = saveTitle.trim();
    if (!title) return;
    props.onSaveCurrent({ title, category: saveCategory, style: "custom" });
    setSaveOpen(false);
    setSaveTitle("");
  };

  return (
    <>
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton className="flex h-[min(650px,calc(100dvh-160px))] max-w-[960px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100%-160px)] sm:max-w-[960px] max-[720px]:h-[calc(100dvh-32px)] max-[720px]:w-[calc(100%-32px)]">
        <DialogHeader className="border-b border-border px-6 py-5 pr-14">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><LayoutTemplate className="size-4" /></span>
            <div>
              <DialogTitle>{t("template_market.title")}</DialogTitle>
              <DialogDescription className="mt-1 text-xs">{t("template_market.description")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-6 py-3">
          <div className="relative min-w-48 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("template_market.search_placeholder")} className="h-9 rounded-xl pl-8 text-xs" /></div>
          <Button variant={source === "mine" ? "default" : "outline"} size="sm" className="min-w-0 rounded-xl" onClick={() => setSource((value) => value === "mine" ? "all" : "mine")}><span className="truncate">{t("template_market.my_templates")}</span></Button>
          <input ref={importRef} type="file" accept=".ipwt" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setPendingImport(file); event.currentTarget.value = ""; }} />
          <Button variant="outline" size="sm" className="min-w-0 rounded-xl" disabled={props.busyId !== null} onClick={() => importRef.current?.click()}><Upload className="size-3.5" /><span className="truncate">{t("template_market.import_ipwt")}</span></Button>
          {props.canSaveCurrent ? <Button variant="outline" size="sm" className="min-w-0 rounded-xl" onClick={() => setSaveOpen((value) => !value)}><Sparkles className="size-3.5" /><span className="truncate">{t("template_market.save_current")}</span></Button> : null}
        </div>

        {pendingImport ? <div className="mx-6 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2"><Upload className="size-4 text-primary" /><span className="min-w-40 flex-1 truncate text-xs">{pendingImport.name} · {(pendingImport.size / 1024).toFixed(1)} KB</span><Button variant="ghost" size="sm" disabled={props.busyId !== null} onClick={() => setPendingImport(null)}>{t("common.cancel")}</Button><Button size="sm" className="rounded-lg" disabled={props.busyId !== null} onClick={async () => { if (await props.onImport(pendingImport)) setPendingImport(null); }}>{props.busyId === "import" ? <Loader2 className="size-3.5 animate-spin" /> : null}{t("template_market.install")}</Button></div> : null}

        {saveOpen ? <div className="mx-6 mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3"><div className="min-w-48 flex-1"><p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t("template_market.template_name")}</p><Input autoFocus value={saveTitle} onChange={(event) => setSaveTitle(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") submitSave(); }} placeholder={t("template_market.template_name_placeholder")} className="h-9 rounded-lg text-xs" /></div><div><p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t("template_market.category")}</p><Select value={saveCategory} onValueChange={(value) => { if (saveCategories.some((entry) => entry.id === value)) setSaveCategory(value as TemplateCategory); }}><SelectTrigger size="sm" className="h-9 rounded-lg"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{saveCategories.map((entry) => <SelectItem key={entry.id} value={entry.id}>{t(entry.labelKey)}</SelectItem>)}</SelectGroup></SelectContent></Select></div><Button size="sm" className="h-9 rounded-lg" disabled={!saveTitle.trim() || props.busyId !== null} onClick={submitSave}>{t("template_market.save_to_my_templates")}</Button></div> : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="hidden w-48 shrink-0 border-r border-border bg-muted/10 p-3 md:block">
            <button type="button" onClick={() => setCategory("all")} className={cn("mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium", category === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground")}><LayoutTemplate className="size-3.5" /><span className="truncate">{t("template_market.all_templates")}</span></button>
            {CATEGORIES.map(({ id, labelKey, Icon }) => <button key={id} type="button" onClick={() => setCategory(id)} className={cn("mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium", category === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground")}><Icon className="size-3.5" /><span className="truncate">{t(labelKey)}</span></button>)}
          </aside>
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-5 flex flex-wrap gap-2 md:hidden"><Button variant={category === "all" ? "default" : "outline"} size="sm" className="rounded-xl" onClick={() => setCategory("all")}>{t("template_market.all")}</Button>{CATEGORIES.map(({ id, labelKey }) => <Button key={id} variant={category === id ? "default" : "outline"} size="sm" className="rounded-xl" onClick={() => setCategory(id)}>{t(labelKey)}</Button>)}</div>
            <div className="mb-5 flex flex-wrap items-center gap-2"><span className="mr-1 text-[11px] font-medium text-muted-foreground">{t("template_market.style_label")}</span><button type="button" onClick={() => setStyle("all")} className={cn("rounded-full px-2.5 py-1 text-[11px] transition", style === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>{t("template_market.all_styles")}</button>{styleOptions.map((option) => <button key={option.id} type="button" onClick={() => setStyle(option.id)} className={cn("rounded-full px-2.5 py-1 text-[11px] transition", style === option.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>{option.label}</button>)}</div>
            {props.loading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-60 animate-pulse rounded-2xl bg-muted" />)}</div> : props.error ? <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center"><p className="text-sm">{props.error}</p><Button variant="outline" size="sm" className="mt-3 rounded-xl" onClick={props.onRefresh}>{t("template_market.retry")}</Button></div> : visible.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map((template) => <TemplateCard key={template.manifest.id} template={template} getCover={props.getCover} busy={props.busyId !== null} onPreview={() => setPreviewTemplate(template)} onUse={() => props.onUse(template)} onInstall={() => props.onInstall(template.manifest.id)} onUninstall={() => props.onUninstall(template.manifest.id)} />)}</div> : <div className="rounded-2xl border border-dashed border-border p-10 text-center"><LayoutTemplate className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{t("template_market.no_match_title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("template_market.no_match_desc")}</p></div>}
          </section>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}>
      <DialogContent showCloseButton className="max-w-[960px] gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        {previewTemplate ? <>
          <div className="aspect-video overflow-hidden bg-muted"><TemplateCover template={previewTemplate} getCover={props.getCover} alt={t("template_market.preview_alt", { title: previewTemplate.manifest.title })} /></div>
          <div className="flex flex-col gap-4 border-t border-border px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><DialogTitle className="text-lg">{previewTemplate.manifest.title}</DialogTitle>{isPptxCompatibleTemplate(previewTemplate.manifest) ? <Badge className="text-[10px]">PPTX-compatible</Badge> : null}<Badge variant="outline" className="text-[10px]">{t(CATEGORIES.find((item) => item.id === previewTemplate.manifest.category)?.labelKey ?? "template_market.category.other")}</Badge><Badge variant="outline" className="text-[10px]">{templateStyleLabel(previewTemplate.manifest.style)}</Badge></div><DialogDescription className="mt-2 max-w-2xl text-xs leading-5">{previewTemplate.manifest.description}</DialogDescription><p className="mt-2 text-[10px] text-muted-foreground">{previewTemplate.manifest.source.name} / {previewTemplate.manifest.source.license}</p></div>
            <div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" className="rounded-xl" onClick={() => setPreviewTemplate(null)}>{t("common.back")}</Button><Button size="sm" className="rounded-xl" disabled={props.busyId !== null} onClick={() => { if (previewTemplate.updateAvailable || !previewTemplate.installed) props.onInstall(previewTemplate.manifest.id); else { const template = previewTemplate; setPreviewTemplate(null); props.onUse(template); } }}>{props.busyId === previewTemplate.manifest.id ? <Loader2 className="size-3.5 animate-spin" /> : null}{previewTemplate.updateAvailable ? t("template_market.update_template") : previewTemplate.installed ? t("template_market.use_template") : t("template_market.install_template")}</Button></div>
          </div>
        </> : null}
      </DialogContent>
    </Dialog>
    </>
  );
}

function TemplateCard({ template, getCover, busy, onPreview, onUse, onInstall, onUninstall }: { template: TemplateCatalogItem; getCover: TemplateCoverLoader; busy: boolean; onPreview: () => void; onUse: () => void; onInstall: () => void; onUninstall: () => void }) {
  const category = CATEGORIES.find((item) => item.id === template.manifest.category);
  const primaryAction = template.updateAvailable ? onInstall : template.installed ? onUse : onInstall;
  const primaryLabel = template.updateAvailable ? t("template_market.update") : template.installed ? t("template_market.use") : t("template_market.install");
  return <article className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg"><button type="button" className="relative block aspect-[16/9] w-full overflow-hidden bg-muted text-left" onClick={onPreview} aria-label={t("template_market.preview_aria", { title: template.manifest.title })}><TemplateCover template={template} getCover={getCover} alt={t("template_market.cover_alt", { title: template.manifest.title })} /><div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/55 to-transparent p-3"><Badge variant="secondary" className="bg-black/35 text-[10px] text-white backdrop-blur">{category ? t(category.labelKey) : null}</Badge><span className="rounded-full bg-black/35 px-2 py-1 text-[10px] text-white backdrop-blur">{templateStyleLabel(template.manifest.style)}</span></div></button><div className="p-4"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><h3 className="truncate text-sm font-semibold">{template.manifest.title}</h3>{isPptxCompatibleTemplate(template.manifest) ? <Badge className="text-[10px]">PPTX-compatible</Badge> : null}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.manifest.description}</p></div><div className="flex items-center gap-1">{template.updateAvailable ? <Badge className="text-[10px]">{t("template_market.update")}</Badge> : null}{template.sourceType === "local" ? <Badge variant="outline" className="text-[10px]">{t("template_market.mine_badge")}</Badge> : <Badge variant="outline" className="text-[10px]">{t("template_market.official_badge")}</Badge>}{template.installed ? <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="size-7 rounded-lg text-muted-foreground" aria-label={t("template_market.more_actions_aria", { title: template.manifest.title })} />}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-36"><DropdownMenuItem variant="destructive" onClick={onUninstall}><Trash2 className="size-3.5" />{t("template_market.uninstall_template")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</div></div><div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5"><span className="truncate text-[10px] text-muted-foreground">{template.manifest.tags.slice(0, 2).join(" / ") || template.manifest.subcategory}</span><Button variant="outline" size="sm" className="h-7 rounded-lg px-2 text-[11px]" onClick={onPreview}><Eye className="size-3" />{t("template_market.preview")}</Button><Button size="sm" className="h-7 rounded-lg px-2.5 text-[11px]" disabled={busy} onClick={primaryAction}>{busy ? <Loader2 className="size-3 animate-spin" /> : null}{primaryLabel}</Button></div></div></article>;
}
