import {cva} from "class-variance-authority"
import {clsx, type ClassValue} from "clsx"
import {twMerge} from "tailwind-merge"
export const cn = (...values: ClassValue[]) => twMerge(clsx(values))
export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding py-0 text-[13px] font-medium leading-[18px] whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 relative",
  {
    variants: {
      variant: {
        default: "bg-action text-action-foreground hover:bg-action-hover active:bg-action-pressed active:text-action-pressed-foreground bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
        outline:
          "border-border bg-muted/20 hover:bg-muted hover:border-foreground/20 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-muted/20 dark:hover:bg-input/30 dark:hover:border-input/80 bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)] active:not-aria-[haspopup]:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground active:not-aria-[haspopup]:translate-y-px",
        ghost:
          "hover:bg-muted/60 hover:text-foreground aria-expanded:bg-muted/60 aria-expanded:text-foreground",
        destructive:
          "border-border text-destructive hover:bg-destructive/10 hover:border-destructive/40 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:border-border dark:hover:bg-destructive/10 dark:border-destructive/40 dark:focus-visible:ring-destructive/40 bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)] active:not-aria-[haspopup]:translate-y-px",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[32px] gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 rounded-[8px]",
        xs: "h-6 gap-1 px-2.5 text-[11px] has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[28px] gap-1 px-2 has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 rounded-[8px]",
        lg: "h-[36px] gap-1.5 px-4 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-2.5 rounded-[12px]",
        icon: "size-[32px] p-0",
        "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[28px] p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-[36px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const settingsCompactButtonSize = "h-[28px] px-2 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3.5"
const settingsCompactIconButtonSize = "size-[28px] [&_svg:not([class*='size-'])]:size-3.5"

export const settingsButtonVariants = cva(
  "gap-[6px] rounded-[8px] text-[13px] font-medium leading-[18px] before:pointer-events-none before:absolute before:inset-0 before:rounded-[7px] active:not-aria-[haspopup]:translate-y-0",
  {
    variants: {
      variant: {
        default: "",
        outline:
          "bg-transparent shadow-none before:shadow-none hover:bg-foreground/[0.06] active:bg-foreground/[0.12] aria-expanded:bg-foreground/[0.08] aria-pressed:bg-foreground/[0.08] aria-selected:bg-foreground/[0.08] data-[state=on]:bg-foreground/[0.08] data-[state=open]:bg-foreground/[0.08] dark:bg-transparent dark:before:shadow-none dark:hover:bg-foreground/[0.06] dark:active:bg-foreground/[0.12]",
        secondary:
          "bg-foreground/[0.08] hover:bg-foreground/[0.10] active:bg-foreground/[0.12]",
        ghost:
          "bg-transparent hover:bg-foreground/[0.06] active:bg-foreground/[0.12] aria-expanded:bg-foreground/[0.08] aria-pressed:bg-foreground/[0.08] aria-selected:bg-foreground/[0.08] data-[state=on]:bg-foreground/[0.08] data-[state=open]:bg-foreground/[0.08]",
        destructive: "",
        link: "",
      },
      size: {
        default: settingsCompactButtonSize,
        xs: settingsCompactButtonSize,
        sm: settingsCompactButtonSize,
        lg: settingsCompactButtonSize,
        icon: settingsCompactIconButtonSize,
        "icon-xs": settingsCompactIconButtonSize,
        "icon-sm": settingsCompactIconButtonSize,
        "icon-lg": settingsCompactIconButtonSize,
      },
    },
  },
)


export const inputClassName = "h-8 w-full min-w-0 rounded-lg border border-border px-2.5 py-1 text-ui-control transition-[color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-ui-control file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 relative inline-flex bg-background not-dark:bg-clip-padding text-foreground ring-ring/24 has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-focus-visible:ring-0 dark:bg-background/40 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24"
export const textareaClassName = "field-sizing-content flex min-h-16 w-full min-w-0 resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-ui-control not-dark:bg-clip-padding text-foreground ring-ring/24 transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0 focus-visible:ring-ring/30 has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-focus-visible:ring-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-background/40 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 relative"
