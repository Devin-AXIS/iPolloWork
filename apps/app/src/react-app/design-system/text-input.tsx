/** @jsxImportSource react */
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

export type TextInputProps = ComponentProps<"input"> & {
  label?: string;
  hint?: string;
};

export function TextInput({ label, hint, className, ref, ...rest }: TextInputProps) {
  return (
    <label className="block">
      {label ? (
        <div className="mb-1 text-xs font-medium text-dls-secondary">
          {label}
        </div>
      ) : null}
      <Input
        ref={ref}
        className={`bg-dls-surface text-dls-text placeholder:text-dls-secondary border-dls-border ${
          className ?? ""
        }`.trim()}
        {...rest}
      />
      {hint ? (
        <div className="mt-1 text-xs text-dls-secondary">{hint}</div>
      ) : null}
    </label>
  );
}
