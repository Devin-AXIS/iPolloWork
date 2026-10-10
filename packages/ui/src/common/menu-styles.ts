export const menuSurfaceClassName = "relative isolate rounded-[8px]! bg-popover/90 text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150";

export const composerMenuSurfaceClassName = `${menuSurfaceClassName} rounded-xl! bg-popover/80! dark:bg-popover/72! shadow-[0_8px_20px_rgba(23,31,36,0.10)] ring-1 ring-border/70 backdrop-blur-2xl backdrop-saturate-150`;

export const menuInteractionClassName = "**:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-destructive/10! **:data-[variant=destructive]:text-destructive! **:data-[variant=destructive]:**:text-destructive!";

export const menuDensityClassNames = {
  default: {
    content: "p-1.5",
    item: "min-h-8 rounded-[6px]! px-2 py-1.5 text-ui-control font-medium",
  },
  compact: {
    content: "p-1",
    item: "min-h-7 rounded-[6px]! px-2 py-1 text-ui-control font-medium",
  },
};
