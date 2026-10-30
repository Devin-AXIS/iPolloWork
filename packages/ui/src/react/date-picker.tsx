import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "./calendar";
import { Input } from "./controls";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from "./input-group";
import { Icon } from "./icon";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";

export function parseCalendarDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(0);
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return formatCalendarDate(date) === value ? date : undefined;
}

export function formatCalendarDate(date: Date): string {
  return [String(date.getFullYear()).padStart(4, "0"), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export type DatePickerProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max"> & {
  value: string;
  onValueChange: (value: string) => void;
  calendarLabel: string;
  clearLabel: string;
  min?: string;
  max?: string;
  calendarProps?: Omit<React.ComponentProps<typeof Calendar>, "mode" | "selected" | "onSelect" | "disabled">;
};

export function DatePicker({ value, onValueChange, calendarLabel, clearLabel, calendarProps, min, max, disabled, ...props }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseCalendarDate(value);
  const minimum = min ? parseCalendarDate(min) : undefined;
  const maximum = max ? parseCalendarDate(max) : undefined;
  return <Popover open={open} onOpenChange={setOpen}>
    <InputGroup data-slot="date-picker" className="rounded-lg has-[[data-slot=input-group-control]:focus-visible]:ring-0">
      <InputGroupInput {...props} type="date" value={value} min={min} max={max} disabled={disabled} onChange={event => onValueChange(event.currentTarget.value)} className="[&::-webkit-calendar-picker-indicator]:hidden" />
      {value && !props.required ? <InputGroupAddon align="inline-end" tabIndex={-1}><InputGroupButton size="icon-xs" aria-label={clearLabel} disabled={disabled} onClick={() => onValueChange("")}><Icon name="X" size="s" /></InputGroupButton></InputGroupAddon> : null}
      <InputGroupAddon align="inline-end" tabIndex={-1}>
        <PopoverTrigger render={<InputGroupButton size="icon-xs" disabled={disabled} aria-label={calendarLabel} />}>
          <CalendarDays aria-hidden="true" className="size-3.5" />
        </PopoverTrigger>
      </InputGroupAddon>
    </InputGroup>
    <PopoverContent align="end" className="w-auto gap-0 p-0">
      <Calendar {...calendarProps} mode="single" required={props.required} selected={selected} defaultMonth={selected} disabled={date => !!disabled || (!!minimum && date < minimum) || (!!maximum && date > maximum)}
        onSelect={(date: Date | undefined) => { onValueChange(date ? formatCalendarDate(date) : ""); setOpen(false); }} />
    </PopoverContent>
  </Popover>;
}

export function TimeInput(props: Omit<React.ComponentProps<"input">, "type">) {
  return <Input {...props} type="time" data-slot="time-input" />;
}
