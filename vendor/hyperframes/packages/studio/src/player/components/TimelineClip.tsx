import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { clampAudioGain } from "@hyperframes/core/audio-gain";
import { TimelineClipFades, useClipFadeDraft } from "./TimelineClipFades";
import {
  memo,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { TimelineElement } from "../store/playerStore";
import {
  defaultTimelineTheme,
  getClipHandleOpacity,
  type TimelineTheme,
  type TimelineTrackStyle,
} from "./timelineTheme";
import type { TimelineEditCapabilities } from "./timelineEditing";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { resolveTimelineClipLabel, resolveTimelineKind } from "./timelineLayerPresentation";

interface TimelineClipProps {
  el: TimelineElement;
  pps: number;
  clipY: number;
  isSelected: boolean;
  isHovered: boolean;
  isDragging?: boolean;
  hasCustomContent: boolean;
  hasAnimationRow?: boolean;
  animationContent?: ReactNode;
  capabilities: TimelineEditCapabilities;
  theme?: TimelineTheme;
  visualStyle: TimelineTrackStyle;
  isComposition: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeStart?: (edge: "start" | "end", e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children?: ReactNode;
}

// fallow-ignore-next-line complexity
export const TimelineClip = memo(function TimelineClip({
  el,
  pps,
  clipY,
  isSelected,
  isHovered,
  isDragging = false,
  hasCustomContent,
  hasAnimationRow = false,
  animationContent,
  capabilities,
  theme = defaultTimelineTheme,
  visualStyle,
  isComposition,
  onHoverStart,
  onHoverEnd,
  onPointerDown,
  onResizeStart,
  onClick,
  onDoubleClick,
  onContextMenu,
  children,
}: TimelineClipProps) {
  const fade = useClipFadeDraft(el);
  const [animationsExpanded, setAnimationsExpanded] = useState(true);
  const hasFades = el.tag === "audio" || el.hasAudio;
  const leftPx = el.start * pps;
  const widthPx = Math.max(el.duration * pps, 4);
  const isMicroClip = widthPx < 40;
  const handleOpacity = getClipHandleOpacity({ isHovered, isSelected, isDragging });
  const displayLabel = resolveTimelineClipLabel(el);
  const showHandles = handleOpacity > 0.01 && (widthPx >= 32 || isSelected);
  const showLabel = !hasCustomContent && !isMicroClip;
  const showDefaultText = !hasCustomContent && !isMicroClip;
  const startLabel = el.start.toFixed(1);
  const endLabel = (el.start + el.duration).toFixed(1);
  const timelineKind = resolveTimelineKind(el);
  const clipClassName = [
    "timeline-clip",
    "absolute",
    hasCustomContent || hasAnimationRow
      ? "overflow-visible"
      : "overflow-hidden",
    isSelected ? "is-selected" : "",
    isHovered ? "is-hovered" : "",
    isDragging ? "is-dragging" : "",
    isMicroClip ? "is-micro" : "",
    isAudioTimelineElement(el) ? "is-audio" : "",
    `is-${timelineKind}`,
  ]
    .filter((className) => className.length > 0)
    .join(" ");
  interface TimelineClipCssProperties extends CSSProperties {
    "--timeline-clip-background": string;
    "--timeline-clip-background-active": string;
    "--timeline-clip-background-hover": string;
    "--timeline-clip-background-dragging": string;
    "--timeline-clip-border": string;
    "--timeline-clip-accent": string;
    "--timeline-clip-label": string;
  }
  const style: TimelineClipCssProperties = {
    left: leftPx,
    width: widthPx,
    top: clipY,
    bottom: hasAnimationRow ? undefined : clipY,
    height: hasAnimationRow ? 23 : undefined,
    borderRadius: theme.clipRadius,
    zIndex: isDragging ? 20 : isSelected ? 10 : isHovered ? 5 : 1,
    // Regular cursor over clips (CapCut-style, user preference) — no grab hand.
    cursor: "default",
    transform: isDragging ? "translateY(-1px)" : undefined,
    "--timeline-clip-background": visualStyle.clip,
    "--timeline-clip-background-active": visualStyle.clipActive ?? visualStyle.clip,
    "--timeline-clip-background-hover": visualStyle.hover ?? visualStyle.clip,
    "--timeline-clip-background-dragging": visualStyle.dragging ?? visualStyle.clip,
    "--timeline-clip-border": visualStyle.border ?? theme.clipBorder,
    "--timeline-clip-accent": visualStyle.accent,
    "--timeline-clip-label": visualStyle.label,
  };

  return (
    <div
      data-clip="true"
      data-el-id={el.key ?? el.id}
      data-clip-start={el.start}
      data-clip-end={el.start + el.duration}
      data-clip-hidden={el.hidden ? "true" : undefined}
      data-timeline-kind={timelineKind}
      className={clipClassName}
      style={style}
      title={
        isComposition
          ? el.compositionSrc
          : `${displayLabel} • ${el.start.toFixed(1)}s – ${(el.start + el.duration).toFixed(1)}s`
      }
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {/* Left trim handle */}
      {showHandles && capabilities.canTrimStart && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => onResizeStart?.("start", e)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 14,
            cursor: "ew-resize",
            zIndex: 4,
          }}
        >
          <div
            className="timeline-clip__handle-bar"
            style={{
              position: "absolute",
              left: 4,
              top: 6,
              bottom: 6,
              width: 2,
              borderRadius: 1,
              background: "rgba(255, 255, 255, 0.55)",
              opacity: handleOpacity * 0.6,
            }}
          />
        </div>
      )}
      {/* Right trim handle */}
      {showHandles && capabilities.canTrimEnd && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => onResizeStart?.("end", e)}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 14,
            cursor: "ew-resize",
            zIndex: 4,
          }}
        >
          <div
            className="timeline-clip__handle-bar"
            style={{
              position: "absolute",
              right: 4,
              top: 6,
              bottom: 6,
              width: 2,
              borderRadius: 1,
              background: "rgba(255, 255, 255, 0.55)",
              opacity: handleOpacity * 0.6,
            }}
          />
        </div>
      )}
      {showLabel && <span className="timeline-clip__label">{displayLabel}</span>}
      {showDefaultText && (
        <span className="timeline-clip__timecode">
          {startLabel}-{endLabel}s
        </span>
      )}
      {hasAnimationRow && (
        <>
          <button
            type="button"
            className="absolute right-3 top-0.5 z-[8] rounded bg-panel-input px-1 text-[8px] text-panel-text-2"
            aria-label={`${animationsExpanded ? "收起" : "展开"} ${displayLabel} 动画行`}
            aria-expanded={animationsExpanded}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setAnimationsExpanded((expanded) => !expanded);
            }}
          >
            {animationsExpanded ? "▾" : "▸"} Visual
          </button>
          {animationsExpanded && (
            <>
              <div data-testid="timeline-visual-row" className="pointer-events-none absolute inset-x-0 top-[25px] h-[16px] rounded-sm border border-panel-border bg-panel-input/40" />
              {animationContent}
            </>
          )}
        </>
      )}
      {children}
      {hasFades && isSelected && widthPx >= 100 && (
        <ClipVolumeInput element={el} />
      )}
      {hasFades && (
        <TimelineClipFades
          el={el}
          pps={pps}
          widthPx={widthPx}
          showHandles={(isHovered || isSelected) && !isDragging}
          focusable={isSelected}
          fade={fade}
        />
      )}
    </div>
  );
});

/** Clip gain shares the official attribute writer and preview/export gain contract. */
function ClipVolumeInput({ element }: { element: TimelineElement }) {
  const {
    onSetElementAttributeLive,
    onSetElementAttributeQuiet,
    onRevertElementAttributeLive,
  } = useTimelineEditContextOptional();
  const authored = element.volume ?? 1;
  const [value, setValue] = useState(String(Math.round(authored * 100)));
  const [saving, setSaving] = useState(false);
  useEffect(
    () => setValue(String(Math.round(authored * 100))),
    [element.key, authored],
  );
  const revert = () => {
    onRevertElementAttributeLive?.(element, "data-volume");
    setValue(String(Math.round(authored * 100)));
  };
  const save = async () => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !value.trim()) {
      revert();
      return;
    }
    const gain = clampAudioGain(numeric / 100);
    if (saving || gain === authored || !onSetElementAttributeQuiet) return;
    setSaving(true);
    try {
      await onSetElementAttributeQuiet(
        element,
        "data-volume",
        String(gain),
        "Change clip volume",
      );
    } catch {
      revert();
    } finally {
      setSaving(false);
    }
  };
  return (
    <label
      className="absolute right-5 bottom-1 z-[8] flex items-center gap-0.5 rounded bg-panel-bg/90 px-1 text-[9px] text-panel-text-1"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        aria-label={`音量 ${element.label ?? element.id} (%)`}
        type="number"
        min="0"
        max="400"
        step="5"
        value={value}
        disabled={saving || !onSetElementAttributeQuiet}
        className="w-8 bg-transparent text-right outline-none"
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (next.trim() && Number.isFinite(Number(next)))
            onSetElementAttributeLive?.(
              element,
              "data-volume",
              String(clampAudioGain(Number(next) / 100)),
            );
        }}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            revert();
          }
        }}
      />
      %
    </label>
  );
}
