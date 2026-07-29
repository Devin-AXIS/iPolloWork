import { type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { BeatStrip, BeatBackgroundLines } from "./BeatStrip";
import { TimelineClip } from "./TimelineClip";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";
import { TimelineLayerHeader } from "./TimelineLayerHeader";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";
import { getTimelineEditCapabilities, resolveBlockedTimelineEditIntent } from "./timelineEditing";
import type { TimelineTheme } from "./timelineTheme";
import { TRACK_H, TRACKS_LEFT_PAD, CLIP_Y, CLIP_HANDLE_W } from "./timelineLayout";
import {
  usePlayerStore,
  type TimelineElement,
  type KeyframeCacheEntry,
} from "../store/playerStore";
import type { DraggedClipState, ResizingClipState, BlockedClipState } from "./useTimelineClipDrag";
import {
  captureTimelineDragSelection,
  expandedChildDragOffsetPx,
  isMultiDragPassenger,
  multiDragPassengerOffsetPx,
  toggleTimelineSelection,
  type MultiDragPreviewInput,
} from "./timelineMultiDragPreview";
import type { TrackVisualStyle } from "./timelineIcons";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";
import { isMusicTrack } from "../../utils/timelineInspector";
import { renderClipChildren } from "./timelineClipChildren";
import { resolveTimelineKind } from "./timelineLayerPresentation";

/**
 * Props shared by the scroll container ({@link TimelineCanvas}) and the lane
 * renderer below. TimelineCanvas passes these straight through via spread, so
 * they are declared once here and both prop types compose from this base — no
 * duplicated prop list.
 */
export interface TimelineLaneBaseProps {
  pps: number;
  trackContentWidth: number;
  theme: TimelineTheme;
  displayTrackOrder: number[];
  trackOrder: number[];
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  elementStyles: Map<string, TrackVisualStyle>;
  selectedElementId: string | null;
  selectedElementIds: Set<string>;
  hoveredClip: string | null;
  draggedClip: DraggedClipState | null;
  blockedClipRef: React.RefObject<BlockedClipState | null>;
  suppressClickRef: React.RefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  onDrillDown?: (element: TimelineElement) => void;
  onSelectElement?: (element: TimelineElement | null) => void;
  setHoveredClip: (key: string | null) => void;
  setShowPopover: (v: boolean) => void;
  setRangeSelection: (v: null) => void;
  setResizingClip: (v: ResizingClipState | null) => void;
  setDraggedClip: (v: DraggedClipState | null) => void;
  setSelectedElementId: (id: string | null) => void;
  syncClipDragAutoScroll: (x: number, y: number) => void;
  shiftClickClipRef: React.RefObject<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null>;
  getPreviewElement: (element: TimelineElement) => TimelineElement;
  getTrackStyle: (tag: string) => TrackVisualStyle;
  keyframeCache?: Map<string, KeyframeCacheEntry>;
  selectedKeyframes: Set<string>;
  currentTime: number;
  onClickKeyframe?: (element: TimelineElement, percentage: number) => void;
  onShiftClickKeyframe?: (elementId: string, percentage: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
  onMoveKeyframe?: (
    elementId: string,
    fromClipPercentage: number,
    toClipPercentage: number,
  ) => void;
  onContextMenuClip?: (e: React.MouseEvent, element: TimelineElement) => void;
  /**
   * Right-click on EMPTY lane space (not on a clip — those preventDefault
   * before this fires — not the gutter/ruler, not below the lanes). `time` is
   * the timeline time (seconds) under the pointer on that lane.
   */
  onContextMenuLane?: (e: React.MouseEvent, track: number, time: number) => void;
  beatAnalysis?: MusicBeatAnalysis | null;
}

interface TimelineLanesProps extends TimelineLaneBaseProps {
  /** Live-derived by TimelineCanvas from {@link TimelineLaneBaseProps.draggedClip}. */
  draggedElement: TimelineElement | null;
  multiDragPreview: MultiDragPreviewInput | null;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onResizeElement: TimelineEditCallbacks["onResizeElement"];
  onMoveElement: TimelineEditCallbacks["onMoveElement"];
  onRazorSplit: TimelineEditCallbacks["onRazorSplit"];
  onRazorSplitAll: TimelineEditCallbacks["onRazorSplitAll"];
}

export function TimelineLanes({
  pps,
  trackContentWidth,
  theme,
  displayTrackOrder,
  trackOrder,
  tracks,
  trackStyles,
  elementStyles,
  selectedElementId,
  selectedElementIds,
  hoveredClip,
  draggedClip,
  draggedElement,
  multiDragPreview,
  blockedClipRef,
  suppressClickRef,
  scrollRef,
  renderClipContent,
  renderClipOverlay,
  onDrillDown,
  onSelectElement,
  setHoveredClip,
  setShowPopover,
  setRangeSelection,
  setResizingClip,
  setDraggedClip,
  setSelectedElementId,
  syncClipDragAutoScroll,
  shiftClickClipRef,
  getPreviewElement,
  getTrackStyle,
  keyframeCache,
  selectedKeyframes,
  currentTime,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
  onMoveKeyframe,
  onContextMenuClip,
  onContextMenuLane,
  beatAnalysis,
  onToggleTrackHidden,
  onResizeElement,
  onMoveElement,
  onRazorSplit,
  onRazorSplitAll,
}: TimelineLanesProps) {
  const collectGestureEligibleKeys = (
    canEdit: (element: TimelineElement) => boolean,
  ): ReadonlySet<string> => {
    const eligibleKeys = new Set<string>();
    for (const [, elements] of tracks) {
      for (const element of elements) {
        if (canEdit(element)) eligibleKeys.add(element.key ?? element.id);
      }
    }
    return eligibleKeys;
  };

  const startClipDrag = (
    element: TimelineElement,
    event: ReactPointerEvent,
    mode: DraggedClipState["mode"],
    bounds: DOMRect,
    selectionKeys: ReadonlySet<string>,
  ) => {
    blockedClipRef.current = null;
    setShowPopover(false);
    setRangeSelection(null);
    setDraggedClip({
      element,
      mode,
      selectionKeys: new Set(selectionKeys),
      originClientX: event.clientX,
      originClientY: event.clientY,
      originScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      originScrollTop: scrollRef.current?.scrollTop ?? 0,
      pointerClientX: event.clientX,
      pointerClientY: event.clientY,
      pointerOffsetX: event.clientX - bounds.left,
      pointerOffsetY:
        mode === "layer-order"
          ? event.clientY - bounds.top - CLIP_Y
          : event.clientY - bounds.top,
      previewStart: element.start,
      previewTrack: element.track,
      desiredTrack: element.track,
      insertRow: null,
      snapTime: null,
      snapType: null,
      started: false,
    });
    syncClipDragAutoScroll(event.clientX, event.clientY);
  };

  return (
    <>
      {
        // NOTE (deliberate no-virtualization): lanes and their clips render via a
        // plain `.map()` inside the scroll container rather than a windowing/virtualized
        // list. NLE clip counts are small (dozens to low hundreds), so the DOM cost is
        // bounded and virtualization's complexity isn't worth it. TODO: revisit and swap
        // in a virtualizer if editorial workflows ever push very high clip counts.
        // fallow-ignore-next-line complexity
        displayTrackOrder.map((trackNum, rowIndex) => {
          const els = tracks.find(([t]) => t === trackNum)?.[1] ?? [];
          const ts = trackStyles.get(trackNum) ?? getTrackStyle("");
          const isPendingTrack =
            draggedClip?.started === true && !trackOrder.includes(trackNum) && els.length === 0;
          // All lanes use the same uniform color — no alternating stripes.
          const rowBackground = theme.rowBackground;
          // The beat-dot strip occupies the top of this track's lane (active track,
          // or the music track when nothing is selected). When shown, keyframe
          // diamonds shrink + drop to the bottom half so they don't collide with it.
          const beatStripOnTrack =
            (beatAnalysis?.beatTimes?.length ?? 0) >= 2 &&
            (selectedElementId
              ? els.some((e) => (e.key ?? e.id) === selectedElementId)
              : els.some(isMusicTrack));
          const isTrackHidden = els.length > 0 && els.every((element) => element.hidden === true);
          const isTrackSelected = els.some((element) => {
            const key = element.key ?? element.id;
            return selectedElementId === key || selectedElementIds.has(key);
          });
          const nextTrack = displayTrackOrder[rowIndex + 1];
          const hasExpandedChildren =
            nextTrack !== undefined && nextTrack > trackNum && nextTrack < Math.floor(trackNum) + 1;
          return (
            <div
              key={trackNum}
              className="hf-timeline-lane relative flex"
              style={{ height: TRACK_H }}
            >
              <TimelineLayerHeader
                track={trackNum}
                elements={els}
                hidden={isTrackHidden}
                selected={isTrackSelected}
                expanded={hasExpandedChildren}
                theme={theme}
                visualStyle={ts}
                onToggleHidden={(hidden) => {
                  void onToggleTrackHidden?.(trackNum, hidden);
                }}
                onSelect={(element) => {
                  usePlayerStore.getState().clearSelectedElementIds();
                  setSelectedElementId(element ? (element.key ?? element.id) : null);
                  onSelectElement?.(element);
                }}
                onReorderPointerDown={
                  onMoveElement
                    ? (event, element) => {
                        if (
                          event.button !== 0 ||
                          usePlayerStore.getState().activeTool === "razor"
                        ) {
                          return;
                        }
                        const elementKey = element.key ?? element.id;
                        setSelectedElementId(elementKey);
                        onSelectElement?.(element);
                        const lane = event.currentTarget.closest(".hf-timeline-lane");
                        const bounds =
                          lane instanceof HTMLElement
                            ? lane.getBoundingClientRect()
                            : event.currentTarget.getBoundingClientRect();
                        startClipDrag(
                          element,
                          event,
                          "layer-order",
                          bounds,
                          new Set([elementKey]),
                        );
                      }
                    : undefined
                }
              />
              {/* Left breathing pad — empty lane surface before t=0, scrolling
                  with the content (the horizontal TRACKS_TOP_PAD). Sits OUTSIDE
                  the time-mapped content div so clip/beat/menu math stays
                  content-relative (clip left = t·pps). */}
              <div
                aria-hidden="true"
                className="flex-shrink-0"
                style={{ width: TRACKS_LEFT_PAD }}
              />
              <div
                style={{
                  width: trackContentWidth,
                  background: rowBackground,
                  borderBottom: `1px solid ${theme.rowBorder}`,
                  opacity: isTrackHidden ? 0.35 : 1,
                  transition: "opacity 120ms ease",
                }}
                className="hf-timeline-row relative"
                onContextMenu={(e: React.MouseEvent) => {
                  // Clip / keyframe-diamond context menus preventDefault at the
                  // target before this bubble handler runs — respect them so a
                  // right-click on a clip never also opens the gap menu.
                  if (e.defaultPrevented || !onContextMenuLane) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const time = (e.clientX - rect.left) / pps;
                  if (time < 0) return;
                  e.preventDefault();
                  onContextMenuLane(e, trackNum, time);
                }}
              >
                {/* Faint beat lines in every track's background (behind the clips);
                    the active move-snap target is highlighted. */}
                <BeatBackgroundLines
                  beatTimes={beatAnalysis?.beatTimes}
                  beatStrengths={beatAnalysis?.beatStrengths}
                  pps={pps}
                  highlightTime={
                    draggedClip?.started && draggedClip.snapType === "beat"
                      ? draggedClip.snapTime
                      : null
                  }
                />
                {/* Beat dots on the active track (the one holding the selection),
                    falling back to the music track when nothing is selected. */}
                {beatStripOnTrack && (
                  <BeatStrip
                    beatTimes={beatAnalysis?.beatTimes}
                    beatStrengths={beatAnalysis?.beatStrengths}
                    pps={pps}
                  />
                )}
                {isPendingTrack && (
                  <div
                    className="absolute inset-0 flex items-center"
                    style={{
                      paddingLeft: 16,
                      color: ts.label,
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      opacity: 0.5,
                    }}
                  >
                    New track
                  </div>
                )}
                {
                  // fallow-ignore-next-line complexity
                  els.map((el) => {
                    const elementKey = el.key ?? el.id;
                    const clipStyle =
                      elementStyles.get(elementKey) ?? getTrackStyle(resolveTimelineKind(el));
                    const capabilities = getTimelineEditCapabilities(el);
                    const isSelected =
                      selectedElementId === elementKey || selectedElementIds.has(elementKey);
                    const isComposition = !!el.compositionSrc;
                    // elementKey (el.key ?? el.id) is already unique per clip; do NOT
                    // fold in the map index, or a splice/reorder remounts every clip
                    // at/after the change (DOM flash, drag interruption).
                    const clipKey = elementKey;
                    const isDraggingClip =
                      draggedClip?.started === true &&
                      (draggedElement?.key ?? draggedElement?.id) === elementKey;
                    if (isDraggingClip) return null;
                    const previewElement = getPreviewElement(el);
                    // Passenger of a live multi-drag: slide by the SAME formation
                    // delta (the grabbed clip's group-clamped delta) via a
                    // compositor transform on a same-geometry wrapper (absolute
                    // inset-0 → identical offset parent, so the clip's own
                    // left/top are preserved), plus the ghost's elevated z/opacity.
                    const isSelectionPassenger =
                      multiDragPreview != null && isMultiDragPassenger(clipKey, multiDragPreview);
                    const hierarchyOffsetPx =
                      multiDragPreview == null
                        ? 0
                        : expandedChildDragOffsetPx(
                            el.expandedDisplayHostKey,
                            pps,
                            multiDragPreview,
                          );
                    const selectionOffsetPx =
                      multiDragPreview == null
                        ? 0
                        : multiDragPassengerOffsetPx(clipKey, pps, multiDragPreview);
                    const isPassenger = isSelectionPassenger || hierarchyOffsetPx !== 0;
                    const passengerOffsetPx = isSelectionPassenger
                      ? selectionOffsetPx
                      : hierarchyOffsetPx;
                    const clip = (
                      <TimelineClip
                        key={clipKey}
                        onContextMenu={(e: React.MouseEvent) => {
                          e.preventDefault();
                          onContextMenuClip?.(e, el);
                        }}
                        el={previewElement}
                        pps={pps}
                        clipY={CLIP_Y}
                        isSelected={isSelected}
                        isHovered={hoveredClip === clipKey}
                        isDragging={false}
                        hasCustomContent={!!renderClipContent}
                        capabilities={capabilities}
                        theme={theme}
                        visualStyle={clipStyle}
                        isComposition={isComposition}
                        onHoverStart={() => setHoveredClip(clipKey)}
                        onHoverEnd={() => setHoveredClip(null)}
                        onResizeStart={
                          // fallow-ignore-next-line complexity
                          (edge, e) => {
                            if (e.button !== 0 || e.shiftKey || !onResizeElement) return;
                            if (edge === "start" && !capabilities.canTrimStart) return;
                            if (edge === "end" && !capabilities.canTrimEnd) return;
                            e.stopPropagation();
                            blockedClipRef.current = null;
                            setShowPopover(false);
                            setRangeSelection(null);
                            const elementKey = el.key ?? el.id;
                            const moveSelectionTogether = e.ctrlKey || e.metaKey;
                            const eligibleKeys = collectGestureEligibleKeys((element) => {
                              const elementCapabilities = getTimelineEditCapabilities(element);
                              return edge === "start"
                                ? elementCapabilities.canTrimStart
                                : elementCapabilities.canTrimEnd;
                            });
                            const gestureSelection = captureTimelineDragSelection(
                              elementKey,
                              usePlayerStore.getState().selectedElementIds,
                              moveSelectionTogether,
                              eligibleKeys,
                            );
                            if (!moveSelectionTogether && gestureSelection.size === 1) {
                              setSelectedElementId(elementKey);
                              onSelectElement?.(el);
                            }
                            setResizingClip({
                              element: el,
                              edge,
                              selectionKeys: gestureSelection,
                              originClientX: e.clientX,
                              originScrollLeft: scrollRef.current?.scrollLeft ?? 0,
                              previewStart: el.start,
                              previewDuration: el.duration,
                              previewPlaybackStart: el.playbackStart,
                              started: false,
                            });
                          }
                        }
                        onPointerDown={
                          // fallow-ignore-next-line complexity
                          (e) => {
                            if (e.button !== 0) return;
                            if (usePlayerStore.getState().activeTool === "razor") return;
                            if (e.shiftKey) {
                              shiftClickClipRef.current = {
                                element: el,
                                anchorX: e.clientX,
                                anchorY: e.clientY,
                              };
                              return;
                            }
                            const target = e.currentTarget as HTMLElement;
                            const rect = target.getBoundingClientRect();
                            const blockedIntent = resolveBlockedTimelineEditIntent({
                              width: rect.width,
                              offsetX: e.clientX - rect.left,
                              handleWidth: CLIP_HANDLE_W,
                              capabilities,
                            });
                            if (
                              blockedIntent &&
                              ((blockedIntent === "move" && onMoveElement) ||
                                (blockedIntent !== "move" && onResizeElement))
                            ) {
                              blockedClipRef.current = {
                                element: el,
                                intent: blockedIntent,
                                originClientX: e.clientX,
                                originClientY: e.clientY,
                                started: false,
                              };
                              return;
                            }
                            if (!onMoveElement || !capabilities.canMove) return;
                            const currentSelection =
                              usePlayerStore.getState().selectedElementIds;
                            const moveSelectionTogether = e.ctrlKey || e.metaKey;
                            const eligibleKeys = collectGestureEligibleKeys(
                              (element) => getTimelineEditCapabilities(element).canMove,
                            );
                            const gestureSelection = captureTimelineDragSelection(
                              elementKey,
                              currentSelection,
                              moveSelectionTogether,
                              eligibleKeys,
                            );
                            const preserveMultiSelection = gestureSelection.size > 1;
                            if (!moveSelectionTogether && !preserveMultiSelection) {
                              setSelectedElementId(elementKey);
                              onSelectElement?.(el);
                            }
                            startClipDrag(el, e, "time", rect, gestureSelection);
                          }
                        }
                        onClick={
                          // fallow-ignore-next-line complexity
                          (e) => {
                            e.stopPropagation();
                            if (suppressClickRef.current) return;
                            const { activeTool } = usePlayerStore.getState();
                            if (activeTool === "razor" && onRazorSplit) {
                              const clipRect = (
                                e.currentTarget as HTMLElement
                              ).getBoundingClientRect();
                              const clickOffsetX = e.clientX - clipRect.left;
                              const splitTime = previewElement.start + clickOffsetX / pps;
                              const clampedTime = Math.max(
                                previewElement.start + SPLIT_BOUNDARY_EPSILON_S,
                                Math.min(
                                  previewElement.start +
                                    previewElement.duration -
                                    SPLIT_BOUNDARY_EPSILON_S,
                                  splitTime,
                                ),
                              );
                              if (e.shiftKey && onRazorSplitAll) {
                                onRazorSplitAll(clampedTime);
                              } else {
                                onRazorSplit(el, clampedTime);
                              }
                              return;
                            }
                            if (e.ctrlKey || e.metaKey) {
                              const store = usePlayerStore.getState();
                              const nextSelection = toggleTimelineSelection(
                                elementKey,
                                store.selectedElementIds,
                                store.selectedElementId,
                              );
                              store.setSelection(
                                nextSelection.selectedKeys,
                                nextSelection.anchorKey,
                              );
                              const anchorElement =
                                nextSelection.anchorKey === elementKey
                                  ? el
                                  : tracks
                                      .flatMap(([, elements]) => elements)
                                      .find(
                                        (element) =>
                                          (element.key ?? element.id) ===
                                          nextSelection.anchorKey,
                                      ) ?? null;
                              onSelectElement?.(anchorElement);
                              return;
                            }
                            // Plain click single-selects: drop any marquee multi-selection.
                            // Only a click on the PRIMARY selection toggles it off — a click
                            // on a marquee-selected clip narrows the selection to that clip.
                            const hadMultiSelection = selectedElementIds.size > 0;
                            usePlayerStore.getState().clearSelectedElementIds();
                            const nextElement =
                              selectedElementId === elementKey && !hadMultiSelection ? null : el;
                            setSelectedElementId(nextElement ? elementKey : null);
                            onSelectElement?.(nextElement);
                          }
                        }
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (suppressClickRef.current) return;
                          if (isComposition && onDrillDown) onDrillDown(el);
                        }}
                      >
                        {renderClipChildren(
                          previewElement,
                          clipStyle,
                          renderClipContent,
                          renderClipOverlay,
                        )}
                        {STUDIO_KEYFRAMES_ENABLED && keyframeCache?.get(elementKey) && (
                          <TimelineClipDiamonds
                            keyframesData={keyframeCache.get(elementKey)!}
                            clipWidthPx={Math.max(previewElement.duration * pps, 4)}
                            clipHeightPx={TRACK_H - 2 * CLIP_Y}
                            beatsActive={beatStripOnTrack}
                            accentColor={clipStyle.accent}
                            isSelected={isSelected}
                            currentPercentage={
                              previewElement.duration > 0
                                ? ((currentTime - previewElement.start) / previewElement.duration) *
                                  100
                                : 0
                            }
                            elementId={elementKey}
                            selectedKeyframes={selectedKeyframes}
                            onClickKeyframe={(pct) => onClickKeyframe?.(previewElement, pct)}
                            onShiftClickKeyframe={onShiftClickKeyframe}
                            onContextMenuKeyframe={onContextMenuKeyframe}
                            onMoveKeyframe={onMoveKeyframe}
                            suppressClickRef={suppressClickRef}
                          />
                        )}
                      </TimelineClip>
                    );
                    if (!isPassenger) return clip;
                    return (
                      <div
                        key={clipKey}
                        className="absolute inset-0"
                        style={{
                          transform: `translateX(${passengerOffsetPx}px)`,
                          opacity: 0.85,
                          zIndex: 20,
                          pointerEvents: "none",
                        }}
                      >
                        {clip}
                      </div>
                    );
                  })
                }
              </div>
            </div>
          );
        })
      }
    </>
  );
}
