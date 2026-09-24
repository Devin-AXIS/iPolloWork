/** @jsxImportSource react */
import * as React from "react";

import {
  menuDensityClassNames,
  menuInteractionClassName,
  menuSurfaceClassName,
} from "../components/ui/menu-styles";
import { cn } from "../lib/utils";

function ContextMenuContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="context-menu-content"
      data-open=""
      data-side="bottom"
      className={cn(
        "z-50 max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-start-2 data-[side=inline-start]:slide-in-from-end-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 animate-none!",
        menuSurfaceClassName,
        menuInteractionClassName,
        menuDensityClassNames.default.content,
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuItem({
  className,
  disabled,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<"button"> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      data-slot="context-menu-item"
      data-inset={inset ? "" : undefined}
      data-variant={variant}
      data-disabled={disabled ? "" : undefined}
      disabled={disabled}
      className={cn(
        "group/context-menu-item relative flex w-full cursor-default items-center gap-2.5 outline-hidden select-none hover:bg-foreground/10 focus:bg-accent focus:text-accent-foreground active:bg-foreground/10 data-inset:ps-9.5 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
        menuDensityClassNames.default.item,
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="context-menu-separator"
      role="separator"
      className={cn("-mx-1.5 my-1.5 h-px bg-border/50", className)}
      {...props}
    />
  );
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ms-auto text-xs tracking-widest text-muted-foreground group-focus/context-menu-item:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut };
