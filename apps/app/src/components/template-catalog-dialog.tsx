/** @jsxImportSource react */
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LayoutTemplate, Loader2, Search } from "lucide-react";
import type { TemplateCatalogItem, TemplateCategory } from "@ipollowork/types/templates";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";

export type TemplateCatalogDialogCopy = {
  title: string;
  description: string;
};

export type TemplateCatalogDialogProps<Applied> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queryKey: readonly unknown[];
  copy: TemplateCatalogDialogCopy;
  listTemplates: () => Promise<TemplateCatalogItem[]>;
  getCover: (templateId: string) => Promise<{ data: ArrayBuffer; contentType: string | null }>;
  applyTemplate: (templateId: string) => Promise<Applied>;
  onApplied: (result: Applied) => void;
};

function categoryLabel(category: TemplateCategory) {
  return t(`template_market.category.${category}`);
}

function TemplateCover(props: {
  template: TemplateCatalogItem;
  load: (templateId: string) => Promise<{ data: ArrayBuffer; contentType: string | null }>;
}) {
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [source, setSource] = React.useState("");

  React.useEffect(() => {
    const target = placeholderRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "360px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    let active = true;
    let objectUrl = "";
    void props.load(props.template.manifest.id).then((cover) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([cover.data], { type: cover.contentType ?? "image/png" }));
      setSource(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.load, props.template.manifest.id, visible]);

  return (
    <div ref={placeholderRef} className="aspect-[16/10] overflow-hidden bg-muted">
      {source ? (
        <img
          src={source}
          alt={t("template_market.cover_alt", { title: props.template.manifest.title })}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="grid h-full place-items-center text-muted-foreground"><LayoutTemplate className="size-6" /></div>
      )}
    </div>
  );
}

export function TemplateCatalogDialog<Applied>(props: TemplateCatalogDialogProps<Applied>) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");
  const [pending, setPending] = React.useState<TemplateCatalogItem | null>(null);
  const templatesQuery = useQuery({
    queryKey: props.queryKey,
    queryFn: props.listTemplates,
    enabled: props.open,
    staleTime: 60_000,
  });
  const applyMutation = useMutation({
    mutationFn: props.applyTemplate,
    onSuccess: (result) => {
      props.onApplied(result);
      props.onOpenChange(false);
      toast.success(t("design_templates.applied"));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("design_templates.apply_failed")),
  });
  const templates = templatesQuery.data ?? [];
  const categories = React.useMemo(
    () => Array.from(new Set(templates.map((template) => template.manifest.category))),
    [templates],
  );
  const visible = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return templates.filter((template) => {
      if (category !== "all" && template.manifest.category !== category) return false;
      if (!normalized) return true;
      return [template.manifest.title, template.manifest.description, template.manifest.subcategory, ...template.manifest.tags]
        .join(" ").toLowerCase().includes(normalized);
    });
  }, [category, query, templates]);

  React.useEffect(() => {
    if (!props.open) {
      setQuery("");
      setCategory("all");
      setPending(null);
    }
  }, [props.open]);

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="grid h-[min(760px,calc(100dvh-48px))] grid-rows-[auto_auto_minmax(0,1fr)] gap-4 p-5 sm:p-6">
          <DialogHeader className="pr-12">
            <DialogTitle>{props.copy.title}</DialogTitle>
            <DialogDescription>{props.copy.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t("template_market.search_placeholder")}
                className="h-10 rounded-xl pl-9"
              />
            </div>
            {categories.length > 1 ? (
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" aria-label={t("template_market.category")}>
                <Button size="sm" variant={category === "all" ? "secondary" : "ghost"} className="rounded-full" onClick={() => setCategory("all")}>{t("template_market.all")}</Button>
                {categories.map((value) => (
                  <Button key={value} size="sm" variant={category === value ? "secondary" : "ghost"} className="rounded-full" onClick={() => setCategory(value)}>{categoryLabel(value)}</Button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            {templatesQuery.isLoading ? (
              <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            ) : templatesQuery.isError ? (
              <div className="grid h-full place-items-center text-center">
                <div><p className="text-sm font-medium">{t("design_templates.load_failed")}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void templatesQuery.refetch()}>{t("template_market.retry")}</Button></div>
              </div>
            ) : visible.length === 0 ? (
              <div className="grid h-full place-items-center text-center text-muted-foreground">
                <div><LayoutTemplate className="mx-auto mb-3 size-7" /><p className="text-sm font-medium text-foreground">{t("template_market.no_match_title")}</p><p className="mt-1 text-xs">{t("template_market.no_match_desc")}</p></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 pb-1 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((template) => (
                  <button
                    key={template.manifest.id}
                    type="button"
                    className={cn(
                      "group overflow-hidden rounded-2xl border border-border bg-card text-left transition",
                      "hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      applyMutation.isPending && "pointer-events-none opacity-60",
                    )}
                    onClick={() => setPending(template)}
                  >
                    <TemplateCover template={template} load={props.getCover} />
                    <div className="space-y-2 p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-semibold">{template.manifest.title}</p>
                        <Badge variant="secondary" className="shrink-0">{categoryLabel(template.manifest.category)}</Badge>
                      </div>
                      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{template.manifest.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmModal
        open={Boolean(pending)}
        title={t("design_templates.confirm_title")}
        message={t("design_templates.confirm_description", { title: pending?.manifest.title ?? "" })}
        confirmLabel={t("template_market.use_template")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const template = pending;
          setPending(null);
          if (template) applyMutation.mutate(template.manifest.id);
        }}
      />
    </>
  );
}
