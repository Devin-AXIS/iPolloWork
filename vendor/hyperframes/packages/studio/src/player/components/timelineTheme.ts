import type { TimelineElement } from "../store/playerStore";

export interface TimelineTrackStyle {
  clip: string;
  accent: string;
  label: string;
  clipActive?: string;
  border?: string;
  hover?: string;
  dragging?: string;
}

export interface TimelineTheme {
  shellBackground: string;
  shellBorder: string;
  rulerBorder: string;
  rowBackground: string;
  rowBorder: string;
  gutterBackground: string;
  gutterBorder: string;
  textPrimary: string;
  textSecondary: string;
  tickText: string;
  tickMajor: string;
  tickMinor: string;
  clipBackground: string;
  clipBackgroundActive: string;
  clipBorder: string;
  clipBorderHover: string;
  clipBorderActive: string;
  clipShadow: string;
  clipShadowHover: string;
  clipShadowActive: string;
  clipShadowDragging: string;
  handleColor: string;
  panelResizeSeam: string;
  panelResizeActive: string;
  clipRadius: string;
}

const visualTrackStyle = (clip: string, accent: string): TimelineTrackStyle => ({
  clip,
  clipActive: clip,
  accent,
  label: "rgba(255,255,255,0.72)",
  border: "rgba(255,255,255,0.18)",
  hover: clip,
  dragging: clip,
});

const TIMELINE_PALETTE: { accent: string; rgb: string }[] = [
  { accent: "#FF5C8A", rgb: "255,92,138" },
  { accent: "#FF7A59", rgb: "255,122,89" },
  { accent: "#FF9F43", rgb: "255,159,67" },
  { accent: "#F6C945", rgb: "246,201,69" },
  { accent: "#49D17D", rgb: "73,209,125" },
  { accent: "#20C9B5", rgb: "32,201,181" },
  { accent: "#20B8E6", rgb: "32,184,230" },
  { accent: "#4D8DFF", rgb: "77,141,255" },
  { accent: "#6C63FF", rgb: "108,99,255" },
  { accent: "#A66CFF", rgb: "166,108,255" },
  { accent: "#D85CFF", rgb: "216,92,255" },
  { accent: "#F044B3", rgb: "240,68,179" },
];

export function getTimelinePaletteStyle(index: number): TimelineTrackStyle {
  const normalized = ((Math.trunc(index) % TIMELINE_PALETTE.length) + TIMELINE_PALETTE.length) %
    TIMELINE_PALETTE.length;
  const color = TIMELINE_PALETTE[normalized] ?? TIMELINE_PALETTE[0]!;
  return {
    accent: color.accent,
    clip: `rgba(${color.rgb},0.22)`,
    clipActive: `rgba(${color.rgb},0.32)`,
    border: `rgba(${color.rgb},0.62)`,
    hover: `rgba(${color.rgb},0.30)`,
    dragging: `rgba(${color.rgb},0.82)`,
    label: "rgba(255,255,255,0.92)",
  };
}

export const defaultTimelineTheme: TimelineTheme = {
  // Near-black card surfaces: the panels sit dark while the shell canvas
  // between them is a step LIGHTER (#18181B), so the gaps read as visible
  // seams around dark cards (CapCut-style).
  shellBackground: "#0A0A0B",
  shellBorder: "rgba(255,255,255,0.05)",
  rulerBorder: "rgba(255,255,255,0.16)",
  // All track lanes use a single uniform color — one step lighter than the panel
  // surface (#0A0A0B) so lanes are visibly distinct from the ruler/shell.
  rowBackground: "#101014",
  rowBorder: "rgba(255,255,255,0.06)",
  gutterBackground: "#0E0F12",
  gutterBorder: "rgba(255,255,255,0.10)",
  textPrimary: "rgba(255,255,255,0.92)",
  textSecondary: "rgba(255,255,255,0.62)",
  tickText: "rgba(255,255,255,0.34)",
  tickMajor: "rgba(255,255,255,0.10)",
  tickMinor: "rgba(255,255,255,0.06)",
  clipBackground: "#141922",
  clipBackgroundActive: "#181e28",
  clipBorder: "rgba(255,255,255,0.10)",
  clipBorderHover: "rgba(255,255,255,0.18)",
  clipBorderActive: "rgba(255,255,255,0.24)",
  clipShadow: "none",
  clipShadowHover: "0 2px 8px rgba(0,0,0,0.2)",
  clipShadowActive: "0 2px 8px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.04)",
  clipShadowDragging: "0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)",
  handleColor: "rgba(255,255,255,0.2)",
  panelResizeSeam: "rgba(255,255,255,0.12)",
  panelResizeActive: "rgba(255,255,255,0.24)",
  clipRadius: "8px",
};

export function getTimelineTrackStyle(kind: string): TimelineTrackStyle {
  if (kind === "text" || kind === "composition") {
    return visualTrackStyle("rgba(139,92,246,0.28)", "#A78BFA");
  }
  if (kind === "effect") {
    return visualTrackStyle("rgba(245,158,11,0.26)", "#FBBF24");
  }
  if (kind === "music" || kind === "voiceover" || kind === "audio") {
    return visualTrackStyle("rgba(34,197,94,0.22)", "#4ADE80");
  }
  if (kind === "logo" || kind === "image" || kind === "video") {
    return visualTrackStyle("rgba(59,130,246,0.24)", "#60A5FA");
  }
  return visualTrackStyle("rgba(255,255,255,0.055)", "#3CE6AC");
}

export function getClipHandleOpacity({
  isHovered,
  isSelected,
  isDragging,
}: {
  isHovered: boolean;
  isSelected: boolean;
  isDragging: boolean;
}): number {
  if (isDragging) return 0.95;
  if (isSelected) return 0.82;
  if (isHovered) return 0.76;
  return 0;
}

export function getRenderedTimelineElement({
  element,
  draggedElementId,
  previewStart,
  previewTrack,
}: {
  element: TimelineElement;
  draggedElementId: string | null;
  previewStart: number | null;
  previewTrack: number | null;
}): TimelineElement {
  if (
    (element.key ?? element.id) !== draggedElementId ||
    previewStart === null ||
    previewTrack === null
  ) {
    return element;
  }
  return {
    ...element,
    start: previewStart,
    track: previewTrack,
  };
}
