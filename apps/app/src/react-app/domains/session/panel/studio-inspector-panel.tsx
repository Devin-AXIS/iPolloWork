/** @jsxImportSource react */
import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StudioInspectorPanelProps = {
  ariaLabel: string;
  children: React.ReactNode;
  header?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  width?: number;
  testId?: string;
  embedded?: boolean;
};

type StudioInspectorHeaderProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
};

export function StudioInspectorPanel({
  ariaLabel,
  children,
  header,
  className,
  bodyClassName,
  width,
  testId,
  embedded,
}: StudioInspectorPanelProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-[310px] shrink-0 flex-col overflow-hidden border-l border-border bg-background text-foreground",
        className,
      )}
      style={width === undefined ? undefined : { width }}
      aria-label={ariaLabel}
      data-testid={testId}
      data-embedded={embedded === undefined ? undefined : embedded ? "true" : "false"}
    >
      {header}
      <div className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto", bodyClassName)}>
        {children}
      </div>
    </aside>
  );
}

export function StudioInspectorHeader({
  title,
  description,
  icon,
  actions,
  closeLabel,
  onClose,
}: StudioInspectorHeaderProps) {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4">
      {icon ? <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">{title}</p>
        {description ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
      <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={closeLabel}>
        <X />
      </Button>
    </header>
  );
}
