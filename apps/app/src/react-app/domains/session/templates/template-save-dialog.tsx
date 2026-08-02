/** @jsxImportSource react */
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import type { TemplateManifestV1, TemplateValidationReport } from "@ipollowork/types/templates";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";

type TemplateSaveDialogProps = {
  open: boolean;
  template: TemplateManifestV1 | null;
  report: TemplateValidationReport | null;
  validating: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onValidate: () => void;
  onRepair: () => void;
  onSave: (input: { title: string; description: string }) => void;
};

export function TemplateSaveDialog(props: TemplateSaveDialogProps) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  React.useEffect(() => {
    if (!props.open || !props.template) return;
    setTitle(props.template.title);
    setDescription(props.template.description);
  }, [props.open, props.template]);

  const categoryLabel = props.template?.pptxCompatibility
    ? t("template_authoring.type.pptx")
    : props.template
      ? t(`template_market.category.${props.template.category}`)
      : "";
  const errors = props.report?.issues.filter((issue) => issue.severity === "error") ?? [];
  const ready = props.report?.ready === true && errors.length === 0;

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!props.saving) props.onOpenChange(open); }}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5 pr-14">
          <DialogTitle>{t("template_authoring.save_as_template")}</DialogTitle>
          <DialogDescription className="mt-1 text-xs">{t("template_authoring.save_description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <label className="block text-sm font-medium">
            {t("template_authoring.title")}
            <Input className="mt-2" value={title} maxLength={96} onChange={(event) => setTitle(event.currentTarget.value)} />
          </label>
          <label className="block text-sm font-medium">
            {t("template_authoring.description")}
            <Textarea className="mt-2 min-h-20 resize-none" value={description} maxLength={240} onChange={(event) => setDescription(event.currentTarget.value)} />
          </label>
          {props.template ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/25 px-3 py-2.5">
              <Badge variant="secondary">{categoryLabel}</Badge>
              <Badge variant="outline">{props.template.style}</Badge>
              <span className="text-xs text-muted-foreground">{props.template.subcategory}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{t("template_authoring.category_locked")}</span>
            </div>
          ) : null}
          <div className="rounded-xl border border-border px-3 py-3" aria-live="polite">
            <div className="flex items-center gap-2">
              {props.validating ? <Loader2 className="size-4 animate-spin text-primary" /> : ready ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
              <span className="text-sm font-medium">{props.validating ? t("template_authoring.validating") : ready ? t("template_authoring.ready") : t("template_authoring.needs_attention")}</span>
              {!props.validating ? <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={props.onValidate}>{t("template_authoring.revalidate")}</Button> : null}
            </div>
            {props.report?.issues.length ? (
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                {props.report.issues.map((issue, index) => <li key={`${issue.code}:${index}`} className="flex gap-2"><span aria-hidden="true">{issue.severity === "error" ? "•" : "○"}</span><span>{issue.message}</span></li>)}
              </ul>
            ) : null}
            {!props.validating && !ready ? <Button variant="outline" size="sm" className="mt-3" onClick={props.onRepair}><Sparkles className="size-3.5" />{t("template_authoring.ask_ai_to_fix")}</Button> : null}
          </div>
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" disabled={props.saving} onClick={() => props.onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={!ready || !title.trim() || props.saving} onClick={() => props.onSave({ title: title.trim(), description: description.trim() })}>
            {props.saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("template_authoring.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
