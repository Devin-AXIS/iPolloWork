import { type ReactNode } from "react";
import { Tooltip as SharedTooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@ipollowork/ui/tooltip";

interface TooltipProps {
  label: string;
  children: ReactNode;
  delay?: number;
  maxWidth?: number;
  side?: "top" | "bottom";
}

export function Tooltip({ label, children, delay = 400, side = "top", maxWidth }: TooltipProps) {
  return <TooltipProvider delay={delay}>
    <SharedTooltip>
      <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>{children}</TooltipTrigger>
      <TooltipContent side={side} style={maxWidth === undefined ? undefined : { maxWidth }}>{label}</TooltipContent>
    </SharedTooltip>
  </TooltipProvider>;
}
