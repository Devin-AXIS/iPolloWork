/** @jsxImportSource react */
import type { ReactNode } from "react";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type AuthorizationFormField = {
  id: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  description?: ReactNode;
  saved?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
};

type AuthorizationFormDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  fields: ReadonlyArray<AuthorizationFormField>;
  values: Readonly<Record<string, string>>;
  saving?: boolean;
  error?: string | null;
  cancelLabel: string;
  savedLabel: string;
  submitLabel: string;
  savingLabel?: string;
  onValuesChange: (values: Record<string, string>) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function AuthorizationFormDialog(props: AuthorizationFormDialogProps) {
  const setValue = (fieldId: string, value: string) => {
    props.onValuesChange({ ...props.values, [fieldId]: value });
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>
        <FieldGroup className="gap-4">
          {props.fields.map((field) => (
            <Field key={field.id}>
              <FieldLabel>{field.label}</FieldLabel>
              {field.options ? (
                <Select
                  value={props.values[field.id] ?? undefined}
                  onValueChange={(value) => setValue(field.id, value ?? "")}
                  disabled={props.saving}
                >
                  <SelectTrigger className="w-full" aria-label={field.label}>
                    <SelectValue placeholder={field.saved ? props.savedLabel : field.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={field.secret === false ? "text" : "password"}
                  value={props.values[field.id] ?? ""}
                  onChange={(event) => setValue(field.id, event.currentTarget.value)}
                  placeholder={field.saved ? props.savedLabel : field.placeholder}
                  autoComplete={field.secret === false ? "off" : "new-password"}
                  spellCheck={false}
                  className="font-mono"
                  disabled={props.saving}
                />
              )}
              {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
            </Field>
          ))}
        </FieldGroup>
        {props.error ? <p role="alert" className="rounded-xl border border-red-6 bg-red-2 px-3 py-2 text-xs leading-5 text-red-11">{props.error}</p> : null}
        <DialogFooter>
          <DialogClose render={<Button size="sm" variant="outline" />}>
            {props.cancelLabel}
          </DialogClose>
          <Button size="sm" onClick={props.onSubmit} disabled={props.saving}>
            {props.saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {props.saving ? props.savingLabel ?? props.submitLabel : props.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
