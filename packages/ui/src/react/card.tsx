import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { Ellipsis } from "lucide-react"
import { Button } from "./controls"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu"

import { cn } from "../common/control-styles"

const cardVariants = cva(
  "group/card flex flex-col overflow-hidden rounded-[16px] text-ui-body text-card-foreground has-[>img:first-child]:pt-0 *:[img:first-child]:rounded-t-[16px] *:[img:last-child]:rounded-b-[16px]",
  {
    variants: {
      variant: {
        default: "bg-card shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10",
        outline: "border border-border bg-transparent shadow-none",
        resource: "border border-border bg-transparent font-sans text-ui-meta font-normal shadow-none transition-[border-color] hover:border-input",
      },
      size: {
        default: "gap-4 py-4",
        sm: "gap-3 py-3",
      },
      surface: { outline: "", plain: "" },
      layout: {
        stack: "",
        row: "",
      },
    },
    compoundVariants: [
      { variant: "resource", surface: "plain", className: "border-0 transition-colors hover:bg-muted" },
      { variant: "resource", className: "gap-[12px] rounded-[12px] p-[16px]" },
      { variant: "resource", layout: "row", className: "flex-row flex-wrap items-center" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      layout: "stack",
      surface: "outline",
    },
  }
)

function Card({
  className,
  variant = "default",
  size = "default",
  layout = "stack",
  surface = "outline",
  ...props
}: React.ComponentProps<"div"> & Omit<VariantProps<typeof cardVariants>, "layout"> & { layout?: "stack" | "row" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      data-layout={variant === "resource" ? layout : "stack"}
      data-surface={variant === "resource" ? surface : "outline"}
      className={cn(cardVariants({ variant, size, layout, surface }), className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-[16px] px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        "group-data-[variant=resource]/card:flex group-data-[variant=resource]/card:gap-[12px] group-data-[variant=resource]/card:p-0",
        "group-data-[layout=row]/card:min-w-[min(100%,240px)] group-data-[layout=row]/card:flex-1",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, as: Tag = "div", ...props }: React.ComponentProps<"div"> & { as?: "div" | "h3" }) {
  return (
    <Tag
      data-slot="card-title"
      className={cn("font-heading text-ui-section-title font-semibold group-data-[variant=resource]/card:min-w-0 group-data-[variant=resource]/card:font-sans", Tag === "h3" && "m-0", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-ui-body text-muted-foreground group-data-[variant=resource]/card:font-sans group-data-[variant=resource]/card:text-ui-meta group-data-[variant=resource]/card:font-normal", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 group-data-[size=sm]/card:px-3 group-data-[variant=resource]/card:p-0", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-[16px] px-4 group-data-[size=sm]/card:px-3 [.border-t]:pt-4 group-data-[size=sm]/card:[.border-t]:pt-3",
        "group-data-[variant=resource]/card:mt-auto group-data-[variant=resource]/card:flex-wrap group-data-[variant=resource]/card:justify-between group-data-[variant=resource]/card:gap-[12px] group-data-[variant=resource]/card:p-0",
        "group-data-[layout=row]/card:ml-auto group-data-[layout=row]/card:min-w-0 group-data-[layout=row]/card:max-w-full group-data-[layout=row]/card:shrink-0 group-data-[variant=resource]/card:group-data-[layout=row]/card:mt-0 group-data-[variant=resource]/card:group-data-[layout=row]/card:justify-end",
        className
      )}
      {...props}
    />
  )
}

function CardIcon({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-icon" className={cn("flex size-[32px] shrink-0 items-center justify-center bg-transparent [&>svg]:size-[24px] [&>svg.lucide]:[stroke-width:1.5] [&>img]:size-[24px] [&>img]:object-contain", className)} {...props} />
}

function CardMeta({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-meta" className={cn("font-sans text-ui-caption font-normal text-muted-foreground", className)} {...props} />
}

function CardActionsMenu({ label, disabled, children }: { label: string; disabled?: boolean; children: React.ReactNode }) {
  const trigger = React.useRef<HTMLButtonElement>(null)
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button ref={trigger} variant="ghost" size="icon-sm" className="rounded-lg border-0" aria-label={label} disabled={disabled} />}><Ellipsis className="size-4" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" positionerClassName="z-[90]" finalFocus={() => {
      const dialog = [...document.querySelectorAll('[role="dialog"][data-open], [role="alertdialog"][data-open]')].at(-1)
      return !dialog || dialog.contains(trigger.current)
    }}>{children}</DropdownMenuContent>
  </DropdownMenu>
}

export {
  Card,
  CardActionsMenu,
  CardIcon,
  CardMeta,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
