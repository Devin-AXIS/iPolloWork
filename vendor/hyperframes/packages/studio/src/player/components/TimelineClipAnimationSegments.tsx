import {
  memo,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type {
  TimelineAnimationPhase,
  TimelineAnimationSegment,
} from "../../utils/timelineAnimationSegments";
import {
  commitResolvedAnimationSegmentDrag,
  previewAnimationSegmentDelta,
  resolveAnimationSegmentDrag,
} from "../../components/editor/animationSegmentDrag";
import { KEYFRAME_DRAG_THRESHOLD_PX } from "../../components/editor/keyframeDrag";

const PHASE_STYLE: Record<TimelineAnimationPhase, { background: string; label: string }> = {
  entrance: { background: "rgba(34, 211, 238, 0.72)", label: "Entrance" },
  loop: { background: "rgba(250, 204, 21, 0.68)", label: "Loop" },
  exit: { background: "rgba(244, 114, 182, 0.72)", label: "Exit" },
};

interface SegmentDragState {
  animationId: string;
  pointerId: number;
  pointerDownX: number;
  latestPointerX: number;
  clipWidthPx: number;
  startPercentage: number;
  endPercentage: number;
  target: HTMLButtonElement;
  previewFrame: number | null;
  started: boolean;
}

interface TimelineClipAnimationSegmentsProps {
  segments: readonly TimelineAnimationSegment[];
  ownerElement: TimelineElement;
  canMoveAnimationSegment?: (element: TimelineElement, animationId: string) => boolean;
  onMoveAnimationSegment?: (
    element: TimelineElement,
    animationId: string,
    deltaPercentage: number,
  ) => void;
  suppressClickRef?: RefObject<boolean>;
}

export const TimelineClipAnimationSegments = memo(function TimelineClipAnimationSegments({
  segments,
  ownerElement,
  canMoveAnimationSegment,
  onMoveAnimationSegment,
  suppressClickRef,
}: TimelineClipAnimationSegmentsProps) {
  const dragRef = useRef<SegmentDragState | null>(null);
  const consumeClickRef = useRef(false);

  const cancelPreviewFrame = (drag: SegmentDragState) => {
    if (drag.previewFrame === null) return;
    cancelAnimationFrame(drag.previewFrame);
    drag.previewFrame = null;
  };

  const resetDrag = (drag: SegmentDragState) => {
    cancelPreviewFrame(drag);
    drag.target.style.transform = "";
    if (dragRef.current === drag) dragRef.current = null;
  };

  const suppressNextClipClick = () => {
    consumeClickRef.current = true;
    if (suppressClickRef) suppressClickRef.current = true;
    requestAnimationFrame(() => {
      consumeClickRef.current = false;
      if (suppressClickRef) suppressClickRef.current = false;
    });
  };

  const schedulePreview = (drag: SegmentDragState, pointerX: number) => {
    drag.latestPointerX = pointerX;
    if (!drag.started && Math.abs(pointerX - drag.pointerDownX) >= KEYFRAME_DRAG_THRESHOLD_PX) {
      drag.started = true;
    }
    if (!drag.started || drag.previewFrame !== null) return;
    drag.previewFrame = requestAnimationFrame(() => {
      drag.previewFrame = null;
      if (dragRef.current !== drag) return;
      const deltaPercentage = previewAnimationSegmentDelta({
        pointerDownX: drag.pointerDownX,
        pointerMoveX: drag.latestPointerX,
        clipWidthPx: drag.clipWidthPx,
        startPercentage: drag.startPercentage,
        endPercentage: drag.endPercentage,
      });
      const deltaPx = (deltaPercentage / 100) * drag.clipWidthPx;
      drag.target.style.transform = `translate3d(${deltaPx}px, 0, 0)`;
    });
  };

  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.previewFrame !== null) cancelAnimationFrame(drag.previewFrame);
      drag.target.style.transform = "";
      dragRef.current = null;
      consumeClickRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const stillEditable =
      onMoveAnimationSegment !== undefined &&
      segments.some((segment) => segment.animationId === drag.animationId) &&
      canMoveAnimationSegment?.(ownerElement, drag.animationId) === true;
    if (stillEditable) return;
    if (drag.previewFrame !== null) {
      cancelAnimationFrame(drag.previewFrame);
      drag.previewFrame = null;
    }
    drag.target.style.transform = "";
    dragRef.current = null;
    consumeClickRef.current = false;
  }, [
    canMoveAnimationSegment,
    onMoveAnimationSegment,
    ownerElement,
    segments,
  ]);

  if (segments.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 z-[3] h-2">
      <span
        aria-hidden="true"
        className="absolute inset-x-1 inset-y-0 rounded-full bg-black/10"
      />
      {segments.map((segment) => {
        const phaseStyle = PHASE_STYLE[segment.phase];
        const style = {
          left: `${segment.startPercentage}%`,
          width: `${Math.max(0.8, segment.endPercentage - segment.startPercentage)}%`,
          background: phaseStyle.background,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.28) inset",
        };
        const editTarget =
          canMoveAnimationSegment?.(ownerElement, segment.animationId) === true &&
          onMoveAnimationSegment
            ? { ownerElement, onMoveAnimationSegment }
            : null;

        if (!editTarget) {
          return (
            <span
              key={segment.animationId}
              aria-hidden="true"
              data-animation-id={segment.animationId}
              data-animation-phase={segment.phase}
              data-animation-editable="false"
              className="absolute inset-y-0 rounded-full"
              title={`${phaseStyle.label} animation (read-only)`}
              style={style}
            />
          );
        }

        const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
          if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            usePlayerStore.getState().activeTool === "razor"
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const clipWidthPx =
            event.currentTarget.closest("[data-clip]")?.getBoundingClientRect().width ?? 0;
          event.currentTarget.setPointerCapture(event.pointerId);
          consumeClickRef.current = true;
          dragRef.current = {
            animationId: segment.animationId,
            pointerId: event.pointerId,
            pointerDownX: event.clientX,
            latestPointerX: event.clientX,
            clipWidthPx,
            startPercentage: segment.startPercentage,
            endPercentage: segment.endPercentage,
            target: event.currentTarget,
            previewFrame: null,
            started: false,
          };
        };

        const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
          const drag = dragRef.current;
          if (
            !drag ||
            drag.animationId !== segment.animationId ||
            drag.pointerId !== event.pointerId
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          schedulePreview(drag, event.clientX);
        };

        const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
          const drag = dragRef.current;
          if (
            !drag ||
            drag.animationId !== segment.animationId ||
            drag.pointerId !== event.pointerId
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const result = resolveAnimationSegmentDrag({
            pointerDownX: drag.pointerDownX,
            pointerUpX: event.clientX,
            clipWidthPx: drag.clipWidthPx,
            startPercentage: drag.startPercentage,
            endPercentage: drag.endPercentage,
          });
          resetDrag(drag);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          suppressNextClipClick();
          commitResolvedAnimationSegmentDrag(
            segment.animationId,
            result,
            (animationId, deltaPercentage) =>
              editTarget.onMoveAnimationSegment(
                editTarget.ownerElement,
                animationId,
                deltaPercentage,
              ),
          );
        };

        const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
          const drag = dragRef.current;
          if (
            !drag ||
            drag.animationId !== segment.animationId ||
            drag.pointerId !== event.pointerId
          ) {
            return;
          }
          event.stopPropagation();
          resetDrag(drag);
          consumeClickRef.current = false;
        };

        return (
          <button
            type="button"
            key={segment.animationId}
            aria-label={`Move ${phaseStyle.label.toLowerCase()} animation`}
            data-animation-id={segment.animationId}
            data-animation-phase={segment.phase}
            data-animation-editable="true"
            className="pointer-events-auto absolute inset-y-0 rounded-full border-0 p-0"
            title={`Drag to move ${phaseStyle.label.toLowerCase()} animation`}
            style={{
              ...style,
              cursor: "ew-resize",
              touchAction: "none",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handlePointerCancel}
            onClick={(event) => {
              if (consumeClickRef.current) event.stopPropagation();
            }}
          />
        );
      })}
    </div>
  );
});
