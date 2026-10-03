export const menuSurfaceClassName = "dark relative isolate rounded-[8px]! bg-popover/70 text-popover-foreground shadow-lg ring-1 ring-foreground/5 backdrop-blur-2xl backdrop-saturate-150 dark:ring-foreground/10";

export const menuInteractionClassName = "**:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-foreground/10! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:**:text-accent-foreground!";

export const menuDensityClassNames = {
  default: {
    content: "p-1.5",
    item: "rounded-[8px]! px-3 py-2 text-sm font-medium",
  },
  compact: {
    content: "p-1",
    item: "h-8 rounded-[8px]! px-2 text-xs font-normal",
  },
};
