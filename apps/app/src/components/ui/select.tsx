import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"
import {
  menuDensityClassNames,
  menuInteractionClassName,
  menuSurfaceClassName,
} from "./menu-styles"

const Select = SelectPrimitive.Root

type SelectStyleScope = "default" | "settings"

const SelectStyleScopeContext = React.createContext<SelectStyleScope>("default")

function SelectStyleScopeProvider({
  value,
  children,
}: {
  value: SelectStyleScope
  children: React.ReactNode
}) {
  return <SelectStyleScopeContext.Provider value={value}>{children}</SelectStyleScopeContext.Provider>
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  const styleScope = React.useContext(SelectStyleScopeContext)
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn(styleScope === "settings" ? "scroll-my-1" : "scroll-my-1.5", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-start", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  const styleScope = React.useContext(SelectStyleScopeContext)
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        styleScope === "settings"
          ? "group/select flex h-[34px] w-fit items-center justify-between gap-1.5 rounded-[8px] border border-transparent bg-[#f5f6f9] px-3 text-[13px] whitespace-nowrap text-dls-text shadow-none outline-none transition-colors hover:bg-[#f6f7fb] focus-visible:border-[#1FBAC0] focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/20 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-[#eceef2] data-placeholder:text-dls-secondary dark:bg-white/[0.06] dark:hover:bg-white/[0.09] dark:aria-expanded:bg-white/[0.12] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          : "group/select flex w-fit items-center justify-between gap-1.5 rounded-[8px] border border-border bg-input/50 px-3 py-2 text-ui-control whitespace-nowrap transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground group-data-[size=sm]/select:size-3" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  positionerClassName,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = false,
  collisionAvoidance,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger" | "collisionAvoidance"
  > & { positionerClassName?: string }) {
  const styleScope = React.useContext(SelectStyleScopeContext)
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        collisionAvoidance={collisionAvoidance}
        className={cn("isolate z-[70]", positionerClassName)}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "isolate z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-start-2 data-[side=inline-start]:slide-in-from-end-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 animate-none!",
            menuSurfaceClassName,
            menuInteractionClassName,
            styleScope === "settings"
              ? cn("w-max min-w-(--anchor-width) max-w-[min(320px,var(--available-width))] text-dls-text", menuDensityClassNames.compact.content)
              : cn("w-(--anchor-width) min-w-36", menuDensityClassNames.default.content),
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  const styleScope = React.useContext(SelectStyleScopeContext)
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn(
        styleScope === "settings" ? "px-2 py-1.5 text-[11px] text-dls-secondary" : "px-3 py-2.5 text-ui-caption text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  const styleScope = React.useContext(SelectStyleScopeContext)
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        styleScope === "settings"
          ? cn(menuDensityClassNames.compact.item, "relative flex w-full cursor-default items-center gap-2 pe-8 text-dls-secondary outline-hidden select-none data-highlighted:text-dls-text data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4")
          : cn(menuDensityClassNames.default.item, "relative flex w-full cursor-default items-center gap-2.5 pe-8 text-ui-control outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2"),
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className={cn("pointer-events-none", styleScope === "settings" && "text-[#1FBAC0]")} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  const styleScope = React.useContext(SelectStyleScopeContext)
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        styleScope === "settings"
          ? "pointer-events-none my-1 h-px bg-dls-border"
          : "pointer-events-none -mx-1.5 my-1.5 h-px bg-border",
        className
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-transparent py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-transparent py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectStyleScopeProvider,
  SelectTrigger,
  SelectValue,
}
