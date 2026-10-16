import * as React from "react";
import { DayPicker } from "@daypicker/react";
import { zhCN } from "@daypicker/react/locale";
import { cn } from "../common/control-styles";

export function Calendar({ className, classNames, locale = zhCN, ...props }: React.ComponentProps<typeof DayPicker>) {
  return <DayPicker {...props} locale={locale} data-slot="calendar" className={cn("w-fit max-w-full p-2 text-ui-control", className)}
    classNames={{
      root: "relative", months: "flex flex-wrap gap-3", month: "space-y-2",
      month_caption: "flex h-8 items-center justify-center font-medium",
      nav: "absolute inset-x-2 top-2 flex justify-between",
      button_previous: "grid size-8 appearance-none border-0 bg-transparent p-0 text-ui-control text-foreground place-items-center rounded-lg hover:bg-muted outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40",
      button_next: "grid size-8 appearance-none border-0 bg-transparent p-0 text-ui-control text-foreground place-items-center rounded-lg hover:bg-muted outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40",
      chevron: "size-4 fill-foreground",
      month_grid: "border-collapse", weekday: "size-8 text-ui-caption font-normal text-muted-foreground",
      day: "size-8 p-0 text-center", day_button: "size-8 appearance-none border-0 bg-transparent p-0 text-ui-control text-foreground rounded-lg outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
      selected: "[&>button]:bg-action [&>button]:text-action-foreground [&>button]:hover:bg-action-hover",
      today: "[&>button]:font-semibold [&>button]:underline", outside: "text-muted-foreground opacity-50",
      disabled: "opacity-40", hidden: "invisible", ...classNames,
    }} />;
}
