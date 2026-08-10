/**
 * Consumes playerStore.clipRevealRequest: when another surface (the sidebar
 * asset card / audio row) asks for a clip to be revealed, smooth-scroll the
 * timeline's scroll container so that clip is visible — horizontally to its
 * time and vertically to its lane.
 *
 * The request is consumed (cleared) whether or not the clip node is found, so
 * a stale request can never replay a scroll later. Respects zoom mode: in
 * "fit" the timeline disables horizontal scrolling (overflow-x-hidden), so
 * only the vertical axis is scrolled there.
 */
import { useEffect } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import {
  CLIP_Y,
  GUTTER,
  RULER_H,
  TRACK_H,
  TRACKS_LEFT_PAD,
  getTimelineRowTop,
} from "./timelineLayout";
import { computeRevealScroll } from "./timelineRevealScroll";

interface TimelineRevealGeometry {
  elements: TimelineElement[];
  displayTrackOrder: number[];
  pps: number;
}

export function useTimelineRevealClip(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  geometry: TimelineRevealGeometry,
): void {
  const revealRequest = usePlayerStore((s) => s.clipRevealRequest);

  useEffect(() => {
    if (!revealRequest) return;
    // Consume the request first — reveal is one-shot, even when the clip node
    // isn't currently rendered (e.g. drilled into a different composition).
    usePlayerStore.getState().clearClipRevealRequest();

    const container = scrollRef.current;
    if (!container) return;
    const element = geometry.elements.find(
      (candidate) =>
        candidate.key === revealRequest.elementId ||
        candidate.id === revealRequest.elementId ||
        candidate.domId === revealRequest.elementId,
    );
    if (!element) return;
    const rowIndex = geometry.displayTrackOrder.indexOf(element.track);
    if (rowIndex < 0) return;

    const clipLeft = GUTTER + TRACKS_LEFT_PAD + element.start * geometry.pps;
    const clipTop = getTimelineRowTop(rowIndex) + CLIP_Y;
    const clipWidth = Math.max(element.duration * geometry.pps, 4);

    const target = computeRevealScroll({
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      viewportWidth: container.clientWidth,
      viewportHeight: container.clientHeight,
      clipLeft,
      clipRight: clipLeft + clipWidth,
      clipTop,
      clipBottom: clipTop + TRACK_H - CLIP_Y * 2,
      stickyLeft: GUTTER,
      stickyTop: RULER_H,
      allowHorizontal: usePlayerStore.getState().zoomMode === "manual",
    });
    if (target.left === null && target.top === null) return;
    container.scrollTo({
      left: target.left ?? container.scrollLeft,
      top: target.top ?? container.scrollTop,
      behavior: "smooth",
    });
  }, [geometry.displayTrackOrder, geometry.elements, geometry.pps, revealRequest, scrollRef]);
}
