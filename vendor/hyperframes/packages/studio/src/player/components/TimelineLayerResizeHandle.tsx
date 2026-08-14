import { useCallback, useRef } from "react";
import { useStudioI18n } from "../../i18n";
import {
  DEFAULT_TIMELINE_GUTTER_WIDTH,
  MIN_TIMELINE_GUTTER_WIDTH,
  clampTimelineGutterWidth,
} from "./timelineLayout";

interface TimelineLayerResizeHandleProps {
  width: number;
  viewportWidth: number;
  maxWidth: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onWidthChange: (width: number) => void;
  onCommit: (width: number) => void;
}

export function TimelineLayerResizeHandle({
  width,
  viewportWidth,
  maxWidth,
  containerRef,
  onWidthChange,
  onCommit,
}: TimelineLayerResizeHandleProps) {
  const { tx } = useStudioI18n();
  const dragRef = useRef<{ pointerId: number; originX: number; originWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const commitDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onCommit(widthRef.current);
  }, [onCommit]);

  const setClampedWidth = useCallback(
    (nextWidth: number) => {
      const measuredViewport = containerRef.current?.getBoundingClientRect().width ?? viewportWidth;
      const clampedWidth = clampTimelineGutterWidth(nextWidth, measuredViewport);
      widthRef.current = clampedWidth;
      onWidthChange(clampedWidth);
    },
    [containerRef, onWidthChange, viewportWidth],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={tx("Resize layer panel (arrow keys)")}
      aria-valuemin={MIN_TIMELINE_GUTTER_WIDTH}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      data-testid="timeline-layer-resize-handle"
      className="group absolute bottom-0 top-0 z-[90] w-[6px] cursor-col-resize outline-none"
      style={{ left: width - 3, touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = {
          pointerId: event.pointerId,
          originX: event.clientX,
          originWidth: widthRef.current,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setClampedWidth(drag.originWidth + event.clientX - drag.originX);
      }}
      onPointerUp={commitDrag}
      onPointerCancel={commitDrag}
      onLostPointerCapture={commitDrag}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextWidth = clampTimelineGutterWidth(DEFAULT_TIMELINE_GUTTER_WIDTH, viewportWidth);
        onWidthChange(nextWidth);
        onCommit(nextWidth);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowRight" ? 16 : -16;
        const nextWidth = clampTimelineGutterWidth(widthRef.current + delta, viewportWidth);
        onWidthChange(nextWidth);
        onCommit(nextWidth);
      }}
    >
      <div className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[#1FBAC0] group-focus-visible:bg-[#1FBAC0] group-active:bg-[#1FBAC0]" />
    </div>
  );
}
