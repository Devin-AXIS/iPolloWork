import * as React from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group";
import { Icon } from "./icon";
import { cn } from "../common/control-styles";

export type SearchFieldProps = Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel: string;
  containerClassName?: string;
};

export function SearchField({ value, onValueChange, clearLabel, containerClassName, disabled, ...props }: SearchFieldProps) {
  const input = React.useRef<HTMLInputElement>(null);
  return <InputGroup data-slot="search-field" className={cn("rounded-lg has-[[data-slot=input-group-control]:focus-visible]:ring-0", containerClassName)}>
    <InputGroupInput {...props} ref={input} type="search" value={value} disabled={disabled} onChange={event => onValueChange(event.currentTarget.value)} className={cn("min-w-0 [&::-webkit-search-cancel-button]:appearance-none", props.className)} />
    <InputGroupAddon aria-hidden="true" tabIndex={-1}><Icon name="Search" /></InputGroupAddon>
    {value ? <InputGroupAddon align="inline-end" tabIndex={-1}>
      <InputGroupButton size="icon-xs" disabled={disabled} aria-label={clearLabel} onClick={() => { onValueChange(""); input.current?.focus(); }}><Icon name="X" size="s" /></InputGroupButton>
    </InputGroupAddon> : null}
  </InputGroup>;
}
