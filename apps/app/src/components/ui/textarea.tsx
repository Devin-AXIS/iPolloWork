import * as React from "react";

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content flex min-h-16 w-full min-w-0 resize-none rounded-lg border border-border bg-background px-3 py-3 text-ui-control not-dark:bg-clip-padding text-foreground ring-ring/24 transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-background/40 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 relative",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
