/** @jsxImportSource react */
import * as React from "react";
import { Plus, Settings2, Trash2 } from "lucide-react";
import type {
  WorkBoardConfig,
  WorkBoardConfigValue,
  WorkBoardField,
} from "@ipollowork/types/work-items";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

const FIELD_CLASS_NAME = "h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

function fieldTypeFromValue(value: string): WorkBoardField["type"] {
  if (value === "number" || value === "select" || value === "date" || value === "checkbox") return value;
  return "text";
}

function newFieldId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return `${slug || "field"}_${Date.now().toString(36)}`;
}

export function BoardConfigDialog(props: {
  open: boolean;
  board: WorkBoardConfig;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: WorkBoardConfigValue) => void;
}) {
  const [value, setValue] = React.useState<WorkBoardConfigValue>(() => ({
    columns: props.board.columns,
    fields: props.board.fields,
  }));
  const [fieldLabel, setFieldLabel] = React.useState("");
  const [fieldType, setFieldType] = React.useState<WorkBoardField["type"]>("text");

  React.useEffect(() => {
    if (!props.open) return;
    setValue({ columns: props.board.columns, fields: props.board.fields });
    setFieldLabel("");
    setFieldType("text");
  }, [props.board.columns, props.board.fields, props.open]);

  const addField = () => {
    const label = fieldLabel.trim();
    if (!label || value.fields.length >= 12) return;
    setValue((current) => ({
      ...current,
      fields: [...current.fields, {
        id: newFieldId(label),
        label,
        type: fieldType,
        showOnCard: true,
        ...(fieldType === "select" ? { options: [] } : {}),
      }],
    }));
    setFieldLabel("");
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto rounded-2xl border-white/15 bg-dls-surface/95 backdrop-blur-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 className="size-4" />{t("work.board_settings")}</DialogTitle>
          <DialogDescription>{t("work.board_settings_description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-3">
            <p className="text-xs font-medium text-dls-secondary">{t("work.columns")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {value.columns.map((column, index) => (
                <div key={column.id} className="space-y-1.5 rounded-xl border border-dls-border bg-dls-hover/30 p-3">
                  <Label htmlFor={`column-${column.id}`}>{t("work.column_name")}</Label>
                  <Input
                    id={`column-${column.id}`}
                    value={column.label}
                    onChange={(event) => {
                      const label = event.currentTarget.value;
                      setValue((current) => ({
                        ...current,
                        columns: current.columns.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, label } : item
                        )),
                      }));
                    }}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-dls-secondary">{t("work.custom_fields")}</p>
              <span className="text-[11px] text-dls-tertiary">{value.fields.length}/12</span>
            </div>
            {value.fields.length ? (
              <div className="space-y-2">
                {value.fields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-2">
                    <Input
                      value={field.label}
                      aria-label={t("work.field_name")}
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        setValue((current) => ({
                          ...current,
                          fields: current.fields.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, label } : item
                          )),
                        }));
                      }}
                    />
                    <select
                      value={field.type}
                      className={FIELD_CLASS_NAME}
                      aria-label={t("work.field_type")}
                      onChange={(event) => {
                        const type = fieldTypeFromValue(event.currentTarget.value);
                        setValue((current) => ({
                          ...current,
                          fields: current.fields.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, type } : item
                          )),
                        }));
                      }}
                    >
                      <option value="text">{t("work.field_type.text")}</option>
                      <option value="number">{t("work.field_type.number")}</option>
                      <option value="select">{t("work.field_type.select")}</option>
                      <option value="date">{t("work.field_type.date")}</option>
                      <option value="checkbox">{t("work.field_type.checkbox")}</option>
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("work.remove_field")}
                      onClick={() => setValue((current) => ({
                        ...current,
                        fields: current.fields.filter((item) => item.id !== field.id),
                      }))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                    {field.type === "select" ? (
                      <Input
                        value={(field.options ?? []).join(", ")}
                        className="col-span-3"
                        placeholder={t("work.field_options_placeholder")}
                        onChange={(event) => {
                          const options = event.currentTarget.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 24);
                          setValue((current) => ({
                            ...current,
                            fields: current.fields.map((item) => item.id === field.id ? { ...item, options } : item),
                          }));
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-dls-border px-4 py-5 text-center text-xs text-dls-secondary">
                {t("work.no_custom_fields")}
              </div>
            )}

            <div className="grid gap-2 rounded-xl bg-dls-hover/35 p-3 sm:grid-cols-[minmax(0,1fr)_130px_auto]">
              <Input value={fieldLabel} placeholder={t("work.field_name_placeholder")} onChange={(event) => setFieldLabel(event.currentTarget.value)} />
              <select value={fieldType} className={FIELD_CLASS_NAME} onChange={(event) => setFieldType(fieldTypeFromValue(event.currentTarget.value))}>
                <option value="text">{t("work.field_type.text")}</option>
                <option value="number">{t("work.field_type.number")}</option>
                <option value="select">{t("work.field_type.select")}</option>
                <option value="date">{t("work.field_type.date")}</option>
                <option value="checkbox">{t("work.field_type.checkbox")}</option>
              </select>
              <Button type="button" variant="outline" size="sm" disabled={!fieldLabel.trim() || value.fields.length >= 12} onClick={addField}>
                <Plus className="size-4" />{t("common.add")}
              </Button>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            type="button"
            disabled={props.saving || value.columns.some((column) => !column.label.trim()) || value.fields.some((field) => !field.label.trim())}
            onClick={() => props.onSave(value)}
          >
            {props.saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
