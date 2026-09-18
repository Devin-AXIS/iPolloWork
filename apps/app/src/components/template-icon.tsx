/** @jsxImportSource react */
import type * as React from "react";

import { publicAssetUrl } from "@/app/lib/public-asset";
import { cn } from "@/lib/utils";

export type TemplateIconProps = Omit<React.ComponentProps<"img">, "alt" | "src">;

export function TemplateIcon({ className, ...props }: TemplateIconProps) {
  return (
    <img
      {...props}
      src={publicAssetUrl("sidebar-icon/figma-layout-panel-top.svg")}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 dark:invert", className)}
    />
  );
}
