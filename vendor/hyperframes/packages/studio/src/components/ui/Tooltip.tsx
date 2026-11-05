import { type ReactNode, type ReactElement } from "react";
import { Tooltip as SharedTooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@ipollowork/ui/tooltip";

interface TooltipProps {
  label: string;
  children?: ReactNode;
  render?: ReactElement;
  delay?: number;
  maxWidth?: number;
  side?: "top" | "bottom";
}

export function Tooltip({ label, children, render, delay = 400, side = "top", maxWidth }: TooltipProps) {
  return <TooltipProvider delay={delay}>
    <SharedTooltip>
      {render ? <TooltipTrigger render={render} /> : <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>{children}</TooltipTrigger>}
      <TooltipContent side={side} style={maxWidth === undefined ? undefined : { maxWidth }}>{label}</TooltipContent>
    </SharedTooltip>
  </TooltipProvider>;
}
