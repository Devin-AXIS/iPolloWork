import { memo, useRef, useSyncExternalStore } from "react";
import { TimelineRuler } from "./TimelineRuler";
import { PlayheadIndicator } from "./PlayheadIndicator";
import { getTimelineEditCapabilities, type TimelineRangeSelection } from "./timelineEditing";
import { getRenderedTimelineElement } from "./timelineTheme";
import {
  TRACK_H,
  RULER_H,
  CLIP_Y,
  TRACKS_TOP_PAD,
  TRACKS_BOTTOM_PAD,
  TRACKS_LEFT_PAD,
  PLAYHEAD_HEAD_W,
  getTimelinePlayheadLeft,
  getTimelineRowTop,
} from "./timelineLayout";
import { usePlayerStore } from "../store/playerStore";
import type { ResizingClipState, TimelineDragPreviewStore } from "./useTimelineClipDrag";
import { type MultiDragPreviewInput } from "./timelineMultiDragPreview";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import type { Rect } from "../../utils/marqueeGeometry";
import { TimelineClip } from "./TimelineClip";
import { TimelineLanes, type TimelineLaneBaseProps } from "./TimelineLanes";
import { renderClipChildren } from "./timelineClipChildren";
import { resolveTimelineKind } from "./timelineLayerPresentation";
import type { TimelineLaneGapStrips } from "./useTimelineGapHighlights";
import { BeatBackgroundLines } from "./BeatStrip";

interface TimelineCanvasProps extends TimelineLaneBaseProps {
  major: number[];
  minor: number[];
  totalH: number;
  effectiveDuration: number;
  majorTickInterval: number;
  rangeSelection: TimelineRangeSelection | null;
  /** Live rubber-band multi-select rectangle (canvas coordinates), or null. */
  marqueeRect: Rect | null;
  resizingClip: ResizingClipState | null;
  /** Playhead is being actively scrubbed — fills the grab-handle head. */
  isScrubbing: boolean;
  playheadRef: React.RefObject<HTMLDivElement | null>;
  /** Gap strips: loud on gap-menu-row hover, quiet on the selected clip's lane. */
  laneGapStrips: TimelineLaneGapStrips[];
  dragPreviewStore: TimelineDragPreviewStore;
}

export const TimelineCanvas = memo(function TimelineCanvas(props: TimelineCanvasProps) {
  const { scrollRef, displayTrackOrder } = props;
  const draggedClip = useSyncExternalStore(
    props.dragPreviewStore.subscribe,
    props.dragPreviewStore.getSnapshot,
    props.dragPreviewStore.getSnapshot,
  );
  const {
    onResizeElement,
    onMoveElement,
    onToggleTrackHidden,
    onToggleTrackLocked,
    onRazorSplit,
    onRazorSplitAll,
  } = useTimelineEditContextOptional();
  const beatDragging = usePlayerStore((s) => s.beatDragging);
  const draggedElement = draggedClip?.element ?? null;
  const activeDraggedElement =
    draggedClip?.started === true && draggedElement
      ? getRenderedTimelineElement({
          element: draggedElement,
          draggedElementId: draggedElement.key ?? draggedElement.id,
          previewStart: draggedClip.previewStart,
          previewTrack: draggedClip.previewTrack,
        })
      : null;
  // Time drags follow x on the source row; layer-order drags follow y at the
  // authored time. Keeping the ghost axis-locked mirrors the commit contract.
  const draggedRowIndex =
    draggedClip?.started === true ? displayTrackOrder.indexOf(draggedClip.previewTrack) : -1;
  // Live multi-selection drag: while a selected clip is dragged, ALL selected
  // clips move together as one rigid formation. The GRABBED clip is the free
  // ghost below; its co-selected "passengers" slide by the SAME group-clamped
  // delta (cheap translateX, no re-layout) — the delta is derived from the
  // grabbed clip's ALREADY-clamped previewStart, so the whole formation stops at
  // the wall together and never deforms. Matches what the commit will do — see
  // timelineMultiDragPreview + commit.
  const multiDragPreview: MultiDragPreviewInput | null =
    draggedClip?.started === true && draggedClip.mode === "time" && draggedElement
      ? {
          dragStarted: true,
          draggedKey: draggedElement.key ?? draggedElement.id,
          draggedOriginStart: draggedElement.start,
          draggedPreviewStart: draggedClip.previewStart,
          selectedKeys: draggedClip.selectionKeys,
        }
      : null;
  const laneDragCacheRef = useRef<{ signature: string; value: typeof draggedClip } | null>(null);
  let laneDraggedClip = draggedClip;
  if (!draggedClip) {
    laneDragCacheRef.current = null;
  } else if (draggedClip.selectionKeys.size <= 1) {
    const signature = [
      draggedClip.started,
      draggedClip.mode,
      draggedClip.element.key ?? draggedClip.element.id,
      draggedClip.previewTrack,
      draggedClip.insertRow,
    ].join(":");
    if (laneDragCacheRef.current?.signature !== signature) {
      laneDragCacheRef.current = { signature, value: draggedClip };
    }
    laneDraggedClip = laneDragCacheRef.current.value;
  }
  const activeDraggedPosition = (() => {
    if (draggedClip?.started !== true || !activeDraggedElement || !scrollRef.current) return null;
    const scrollBounds = scrollRef.current.getBoundingClientRect();
    if (draggedClip.mode === "time") {
      const rowIndex = displayTrackOrder.indexOf(draggedClip.element.track);
      if (rowIndex < 0) return null;
      return {
        left:
          draggedClip.pointerClientX -
          scrollBounds.left +
          scrollRef.current.scrollLeft -
          draggedClip.pointerOffsetX,
        top: getTimelineRowTop(rowIndex) + CLIP_Y,
      };
    }
    return {
      left: props.gutterWidth + TRACKS_LEFT_PAD + draggedClip.element.start * props.pps,
      top:
        draggedClip.pointerClientY -
        scrollBounds.top +
        scrollRef.current.scrollTop -
        draggedClip.pointerOffsetY,
    };
  })();
  const activeDraggedStyle = activeDraggedElement
    ? (props.elementStyles.get(activeDraggedElement.key ?? activeDraggedElement.id) ??
      props.getTrackStyle(resolveTimelineKind(activeDraggedElement)))
    : null;

  return (
    <div
      className="relative"
      style={{
        height: props.totalH,
        width: props.gutterWidth + TRACKS_LEFT_PAD + props.trackContentWidth,
      }}
    >
      <TimelineRuler
        major={props.major}
        minor={props.minor}
        pps={props.pps}
        trackContentWidth={props.trackContentWidth}
        totalH={props.totalH}
        effectiveDuration={props.effectiveDuration}
        majorTickInterval={props.majorTickInterval}
        theme={props.theme}
        beatAnalysis={props.beatAnalysis}
        visibleWindow={props.visibleWindow}
        gutterWidth={props.gutterWidth}
      />

      {/* Breathing room between the sticky ruler and the first track lane — the
          top half of the CapCut-style padding (see TRACKS_TOP_PAD). */}
      <div aria-hidden="true" style={{ height: TRACKS_TOP_PAD }} />

      <TimelineLanes
        {...props}
        draggedClip={laneDraggedClip}
        draggedElement={draggedElement}
        multiDragPreview={multiDragPreview}
        onToggleTrackHidden={onToggleTrackHidden}
        onToggleTrackLocked={onToggleTrackLocked}
        onResizeElement={onResizeElement}
        onMoveElement={onMoveElement}
        onRazorSplit={onRazorSplit}
        onRazorSplitAll={onRazorSplitAll}
      />

      {/* Breathing room below the last track lane (~1.5 track heights) — a real
          scrollable surface, so a clip can be dragged into the void to create a
          new bottom track comfortably (see TRACKS_BOTTOM_PAD / getTimelineCanvasHeight). */}
      <div aria-hidden="true" style={{ height: TRACKS_BOTTOM_PAD }} />

      <div
        className="pointer-events-none absolute"
        style={{
          left: props.gutterWidth + TRACKS_LEFT_PAD,
          top: RULER_H + TRACKS_TOP_PAD,
          width: props.trackContentWidth,
          height: displayTrackOrder.length * TRACK_H,
          zIndex: 0,
        }}
      >
        <BeatBackgroundLines
          beatTimes={props.beatAnalysis?.beatTimes}
          beatStrengths={props.beatAnalysis?.beatStrengths}
          pps={props.pps}
          highlightTime={
            draggedClip?.started && draggedClip.snapType === "beat" ? draggedClip.snapTime : null
          }
          visibleTimeRange={props.visibleWindow}
        />
      </div>

      {/* Gap strips — loud dashed fill for the gap(s) a hovered "Close gap(s)"
          menu row would collapse; a quiet tint for every gap on the selected
          clip's lane. Geometry mirrors the drop placeholder (row top + clip
          inset) so strips sit exactly where a clip body would. */}
      {props.laneGapStrips.map((strip) => {
        const rowIndex = displayTrackOrder.indexOf(strip.track);
        if (rowIndex < 0) return null;
        const loud = strip.kind === "hover";
        return strip.intervals.map((gap) => (
          <div
            key={`gap-${strip.kind}-${strip.track}-${gap.start}`}
            className="pointer-events-none absolute"
            style={{
              top: getTimelineRowTop(rowIndex) + CLIP_Y,
              left: props.gutterWidth + TRACKS_LEFT_PAD + gap.start * props.pps,
              width: Math.max((gap.end - gap.start) * props.pps, 2),
              height: TRACK_H - CLIP_Y * 2,
              background: loud ? "rgba(31,186,192,0.18)" : "rgba(31,186,192,0.055)",
              borderRadius: 4,
              zIndex: 25,
            }}
          />
        ));
      })}

      {/* Drop placeholder — a clip-sized slot at the exact landing spot (target
          lane + snapped start), parallel to the ghost. Hidden in insert mode. */}
      {draggedClip?.started && draggedClip.insertRow == null && draggedRowIndex >= 0 && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: getTimelineRowTop(draggedRowIndex) + CLIP_Y,
            left: props.gutterWidth + TRACKS_LEFT_PAD + draggedClip.previewStart * props.pps,
            width: Math.max(draggedClip.element.duration * props.pps, 4),
            height: TRACK_H - CLIP_Y * 2,
            border: "1px solid rgba(31,186,192,0.55)",
            background: "rgba(31,186,192,0.12)",
            borderRadius: 4,
            zIndex: 30,
          }}
        />
      )}

      {/* Insertion line — a new track will be inserted at this boundary on drop.
          Shown while the pointer is near a lane boundary (insert mode). */}
      {draggedClip?.started &&
        draggedClip.mode === "layer-order" &&
        draggedClip.insertRow != null && (
          <div
            className="absolute pointer-events-none"
            style={{
              top: getTimelineRowTop(draggedClip.insertRow) - 0.5,
              left: props.gutterWidth + TRACKS_LEFT_PAD,
              width: props.trackContentWidth,
              height: 1,
              background: "#1FBAC0",
              boxShadow: "0 0 3px rgba(31,186,192,0.5)",
              zIndex: 55,
            }}
          />
        )}

      {/* Snap guide for non-beat targets during clip drag */}
      {draggedClip?.started &&
        draggedClip.mode === "time" &&
        draggedClip.snapTime != null &&
        draggedClip.snapType !== "beat" && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: props.gutterWidth + TRACKS_LEFT_PAD + draggedClip.snapTime * props.pps,
              top: RULER_H,
              bottom: 0,
              width: 1,
              background:
                draggedClip.snapType === "playhead" ? "#1FBAC0" : "rgba(255,255,255,0.6)",
              boxShadow:
                draggedClip.snapType === "playhead"
                  ? "0 0 6px rgba(31,186,192,0.5)"
                  : "0 0 6px rgba(255,255,255,0.4)",
              zIndex: 60,
            }}
          />
        )}

      {/* Drag ghost */}
      {activeDraggedElement && activeDraggedPosition && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: activeDraggedPosition.top,
            left: activeDraggedPosition.left,
            width: Math.max(activeDraggedElement.duration * props.pps, 4),
            height: TRACK_H - CLIP_Y * 2,
            zIndex: 40,
          }}
        >
          <TimelineClip
            el={{ ...activeDraggedElement, start: 0 }}
            pps={props.pps}
            clipY={0}
            isSelected={
              props.selectedElementId === (activeDraggedElement.key ?? activeDraggedElement.id)
            }
            isHovered={false}
            isDragging={true}
            hasCustomContent={!!props.renderClipContent}
            capabilities={getTimelineEditCapabilities(activeDraggedElement)}
            theme={props.theme}
            visualStyle={
              activeDraggedStyle ?? props.getTrackStyle(resolveTimelineKind(activeDraggedElement))
            }
            isComposition={!!activeDraggedElement.compositionSrc}
            onHoverStart={() => {}}
            onHoverEnd={() => {}}
            onResizeStart={() => {}}
            onClick={() => {}}
            onDoubleClick={() => {}}
          >
            {renderClipChildren(
              activeDraggedElement,
              activeDraggedStyle ?? props.getTrackStyle(resolveTimelineKind(activeDraggedElement)),
              props.renderClipContent,
              props.renderClipOverlay,
            )}
          </TimelineClip>
        </div>
      )}

      {/* Marquee (rubber-band) multi-select rectangle — mirrors the canvas
          MarqueeOverlay look: semi-transparent accent fill + dashed border. */}
      {props.marqueeRect && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none"
          style={{
            left: props.marqueeRect.left,
            top: props.marqueeRect.top,
            width: props.marqueeRect.width,
            height: props.marqueeRect.height,
            background: "rgba(31,186,192,0.10)",
            border: "1px dashed rgba(31,186,192,0.7)",
            borderRadius: 2,
            zIndex: 70,
          }}
        />
      )}

      {/* Range highlight */}
      {props.rangeSelection && (
        <div
          className="absolute pointer-events-none"
          style={{
            left:
              props.gutterWidth +
              TRACKS_LEFT_PAD +
              Math.min(props.rangeSelection.start, props.rangeSelection.end) * props.pps,
            width: Math.abs(props.rangeSelection.end - props.rangeSelection.start) * props.pps,
            top: RULER_H,
            bottom: 0,
            backgroundColor: "rgba(59, 130, 246, 0.12)",
            borderLeft: "1px solid rgba(59, 130, 246, 0.4)",
            borderRight: "1px solid rgba(59, 130, 246, 0.4)",
            zIndex: 50,
          }}
        />
      )}

      {/* Playhead — hidden while dragging a beat so its guideline doesn't
          track the scrub and clutter the beat being moved. Explicit width +
          the half-head offset baked into getTimelinePlayheadLeft keep the
          inner 1px line's CENTER exactly on GUTTER + t * pps (the ruler
          ticks' center), instead of relying on shrink-wrap sizing. */}
      <div
        ref={props.playheadRef}
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `${getTimelinePlayheadLeft(0, 0, props.gutterWidth)}px`,
          width: PLAYHEAD_HEAD_W,
          zIndex: 100,
          display: beatDragging ? "none" : undefined,
        }}
      >
        <PlayheadIndicator scrubbing={props.isScrubbing} />
      </div>
    </div>
  );
});
