import type { ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineEditOverrides } from "./useResolvedTimelineEditCallbacks";

export interface TimelineProps extends TimelineDropCallbacks, TimelineEditOverrides {
  onSeek?: (time: number) => void;
  onDrillDown?: (element: TimelineElement) => void;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onSelectElement?: (element: TimelineElement | null) => void;
  onRenameElement?: (element: TimelineElement, label: string) => Promise<void> | void;
  onContextMenuElement?: (
    element: TimelineElement,
    anchor: { x: number; y: number },
  ) => void;
  theme?: Partial<TimelineTheme>;
}
