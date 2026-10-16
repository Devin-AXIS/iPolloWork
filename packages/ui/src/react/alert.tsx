import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { cn } from "../common/control-styles"
import { Button } from "./controls"

const alertVariants = cva(
  "group/alert relative grid w-full grid-cols-[minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-[10px] border-0 px-3 py-3 text-start text-ui-body text-popover-foreground shadow-none has-[>svg]:grid-cols-[24px_minmax(0,1fr)] has-[>[data-slot=alert-title]]:has-[>[data-slot=alert-description]]:*:[svg]:row-span-2 *:[svg]:self-center *:[svg]:size-6 *:[svg]:rounded-full *:[svg]:p-1 *:[svg]:text-background",
  {
    variants: {
      variant: {
        default: "bg-feedback-info *:[svg]:bg-sky-11",
        success: "bg-feedback-success *:[svg]:bg-green-11",
        destructive: "bg-feedback-error *:[svg]:bg-red-11",
        warning: "bg-feedback-warning *:[svg]:bg-amber-11",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  onDismiss,
  closeLabel = "Close",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants> & { onDismiss?: () => void; closeLabel?: string }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), onDismiss && "pe-12", className)}
      {...props}
    >
      {props.children}
      {onDismiss ? <Button type="button" variant="ghost" size="icon-sm" aria-label={closeLabel} onClick={onDismiss} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full border-0 bg-transparent p-0 text-muted-foreground"><XIcon className="m-0 block size-4 shrink-0" aria-hidden /></Button> : null}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "text-ui-section-title font-semibold group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-ui-body text-muted-foreground group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 group-has-[>svg]/alert:col-start-2 [&_button]:text-[13px] [&_button]:font-medium [&_button]:hover:underline [&_button]:focus-visible:rounded-sm [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-ring", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
