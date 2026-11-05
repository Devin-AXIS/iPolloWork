import * as React from "react";
import { NumberField as Primitive } from "@base-ui/react/number-field";
import { Icon } from "./icon";
import { cn } from "../common/control-styles";

export type NumberFieldProps = Omit<Primitive.Root.Props, "className" | "onValueCommitted"> & {
  className?: string;
  label: string;
  suffix?: React.ReactNode;
  inputProps?: Primitive.Input.Props;
  decrementLabel?: string;
  incrementLabel?: string;
  invalidLabel?: string;
  onValueCommitted?: Primitive.Root.Props["onValueCommitted"];
};

export function NumberField({ label, suffix, inputProps, decrementLabel = label + " −", incrementLabel = label + " +", invalidLabel,
  className, value, defaultValue, min, max, required, onValueChange, onValueCommitted, ...props }: NumberFieldProps) {
  const [uncontrolled, setUncontrolled] = React.useState<number | null>(defaultValue ?? null);
  const current = value === undefined ? uncontrolled : value;
  const invalid = current === null ? !!required : (min !== undefined && current < min) || (max !== undefined && current > max);
  const errorId = React.useId();
  const description = [inputProps?.["aria-describedby"], invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return <Primitive.Root {...props} value={current} min={min} max={max} required={required} allowOutOfRange data-slot="number-field" className={cn("min-w-0", className)}
    onValueChange={(next, details) => { setUncontrolled(next); onValueChange?.(next, details); }}
    onValueCommitted={(next, details) => {
      if ((next === null && required) || (next !== null && ((min !== undefined && next < min) || (max !== undefined && next > max)))) return;
      onValueCommitted?.(next, details);
    }}>
    <Primitive.Group className="flex h-8 min-w-0 items-center overflow-hidden rounded-lg border border-border bg-background focus-within:border-ring has-[[aria-invalid=true]]:border-destructive">
      <Primitive.Decrement aria-label={decrementLabel} className="grid h-full w-7 shrink-0 appearance-none border-0 border-solid bg-transparent p-0 text-ui-control text-foreground place-items-center border-r border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"><Icon name="Minus" size="s" /></Primitive.Decrement>
      <Primitive.Input {...inputProps} aria-label={label} aria-invalid={invalid || inputProps?.["aria-invalid"]} aria-describedby={description} className={cn("h-full w-full min-w-0 flex-1 bg-transparent px-2 text-ui-control text-foreground tabular-nums outline-none", inputProps?.className)} />
      {suffix ? <span className="shrink-0 pe-2 text-ui-meta text-muted-foreground">{suffix}</span> : null}
      <Primitive.Increment aria-label={incrementLabel} className="grid h-full w-7 shrink-0 appearance-none border-0 border-solid bg-transparent p-0 text-ui-control text-foreground place-items-center border-l border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"><Icon name="Plus" size="s" /></Primitive.Increment>
    </Primitive.Group>
    {invalid ? <p id={errorId} role="alert" className="mt-2 text-ui-meta text-destructive">{invalidLabel ?? `${label}: ${min ?? "−∞"}–${max ?? "∞"}`}</p> : null}
  </Primitive.Root>;
}
