/** @jsxImportSource react */
import * as React from "react";
import { AlertTriangle, Download, Loader2, Sparkles } from "lucide-react";
import type { TemplateManifestV1, TemplateValidationReport } from "@ipollowork/types/templates";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";

export type TemplateSaveMode = "save" | "export";

export type TemplateSaveInput = {
  title: string;
  description: string;
  mode: TemplateSaveMode;
};

type TemplateSaveDialogProps = {
  open: boolean;
  template: TemplateManifestV1 | null;
  report: TemplateValidationReport | null;
  validating: boolean;
  savingMode: TemplateSaveMode | null;
  onOpenChange: (open: boolean) => void;
  onValidate: () => void;
  onRepair: () => void;
  onSave: (input: TemplateSaveInput) => void;
};

export function TemplateSaveDialog(props: TemplateSaveDialogProps) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  React.useEffect(() => {
    if (!props.open || !props.template) return;
    setTitle(props.template.title);
    setDescription(props.template.description);
  }, [props.open, props.template]);

  const errors = props.report?.issues.filter((issue) => issue.severity === "error") ?? [];
  const ready = props.report?.ready === true && errors.length === 0;

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!props.savingMode) props.onOpenChange(open); }}>
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
          {props.validating || !ready ? <div className="rounded-xl border border-border px-3 py-3" aria-live="polite">
            <div className="flex items-center gap-2">
              {props.validating ? <Loader2 className="size-4 animate-spin text-primary" /> : <AlertTriangle className="size-4 text-amber-600" />}
              <span className="text-sm font-medium">{props.validating ? t("template_authoring.validating") : t("template_authoring.needs_attention")}</span>
              {!props.validating ? <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={props.onValidate}>{t("template_authoring.revalidate")}</Button> : null}
            </div>
            {props.report?.issues.length ? (
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                {props.report.issues.map((issue, index) => <li key={`${issue.code}:${index}`} className="flex gap-2"><span aria-hidden="true">{issue.severity === "error" ? "•" : "○"}</span><span>{issue.message}</span></li>)}
              </ul>
            ) : null}
            {!props.validating && !ready ? <Button variant="outline" size="sm" className="mt-3" onClick={props.onRepair}><Sparkles className="size-3.5" />{t("template_authoring.ask_ai_to_fix")}</Button> : null}
          </div> : null}
        </div>
        <DialogFooter className="mx-0 mb-0 mt-4 flex-wrap border-t border-border px-6 py-5">
          <Button variant="ghost" disabled={props.savingMode !== null} onClick={() => props.onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button variant="outline" disabled={!ready || !title.trim() || props.savingMode !== null} onClick={() => props.onSave({ title: title.trim(), description: description.trim(), mode: "save" })}>
            {props.savingMode === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("template_authoring.save_to_my_templates")}
          </Button>
          <Button disabled={!ready || !title.trim() || props.savingMode !== null} onClick={() => props.onSave({ title: title.trim(), description: description.trim(), mode: "export" })}>
            {props.savingMode === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t("template_authoring.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
