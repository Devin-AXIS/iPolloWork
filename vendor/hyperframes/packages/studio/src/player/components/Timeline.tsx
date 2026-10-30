import { useRef, useMemo, useCallback, useState, useEffect, memo } from "react";
import { roundTo3 } from "../../utils/rounding";
import { useMusicBeatAnalysis } from "../../hooks/useMusicBeatAnalysis";
import { isMusicTrack } from "../../utils/timelineInspector";
import { remapBeatAnalysisToComposition } from "../../utils/beatEditActions";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import {
  useExpandedTimelineElements,
  buildInlineScopeElements,
} from "../hooks/useExpandedTimelineElements";
import { collectTimelineTreeElements } from "../lib/timelineTreeSelection";
import { useMountEffect } from "../../hooks/useMountEffect";
import { defaultTimelineTheme } from "./timelineTheme";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
import { useTimelineActiveClips } from "./useTimelineActiveClips";
import { getTrackStyle } from "./timelineIcons";
import { useTimelineZoom } from "./useTimelineZoom";
import { useTimelineAssetDrop } from "./timelineDragDrop";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineCanvas } from "./TimelineCanvas";
import { type KeyframeDiamondContextMenuState } from "./KeyframeDiamondContextMenu";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import { TimelineOverlays } from "./TimelineOverlays";
import { useTimelineEditPinning } from "./useTimelineEditPinning";
import { useTimelineStackingSync } from "./useTimelineStackingSync";
import { useTimelineGeometry } from "./useTimelineGeometry";
import { buildTimelinePropertyRows } from "../../hooks/gsapTimelineSegmentCache";
import { toSceneLayerRows, toMasterSceneRows, isSceneTimelineElement } from "./timelineZones";
import { useTimelineTrackDerivations } from "./useTimelineTrackDerivations";
import {
  type TimelinePresentationRow,
  getTimelinePresentationTrackOrder,
  DEFAULT_TIMELINE_GUTTER_WIDTH,
  TRACKS_LEFT_PAD,
  clampTimelineGutterWidth,
  generateTicks,
  getTimelineGutterMaxWidth,
  getTimelineCanvasHeight,
  getTimelineVisibleWindow,
} from "./timelineLayout";
import { useTimelineScrollViewport } from "./useTimelineScrollViewport";
import { useTimelineRevealClip } from "./useTimelineRevealClip";
import { STUDIO_PREVIEW_FPS } from "../lib/time";
import { useResolvedTimelineEditCallbacks } from "./useResolvedTimelineEditCallbacks";
import type { TimelineProps } from "./TimelineTypes";
import { useTrackGapMenu } from "./useTrackGapMenu";
import { useTimelineGapHighlights } from "./useTimelineGapHighlights";
import {
  shouldDisplayTimelineElement,
  presentFlatSceneLayers,
  resolveTimelineLayerPrimaryElement,
} from "./timelineLayerPresentation";
import { TimelineLayerResizeHandle } from "./TimelineLayerResizeHandle";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";

// Re-export pure utilities so existing imports from "./Timeline" still resolve.
export {
  generateTicks,
  formatTimelineTickLabel,
  shouldAutoScrollTimeline,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  getTimelinePlayheadLeft,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
  resolveTimelineAssetDrop,
  shouldHandleTimelineDeleteKey,
  getDefaultDroppedTrack,
} from "./timelineLayout";

export const Timeline = memo(function Timeline({
  editingMode = "scene",
  onSeek,
  navigation,
  inlineScope,
  timeOffset = 0,
  visibleDuration,
  onDrillDown,
  renderClipContent,
  renderClipOverlay,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
  onMoveElement: onMoveElementOverride,
  onMoveElements: onMoveElementsOverride,
  onResizeElement: onResizeElementOverride,
  onResizeElements: onResizeElementsOverride,
  onBlockedEditAttempt: onBlockedEditAttemptOverride,
  onSplitElement: onSplitElementOverride,
  onSelectElement,
  onContextMenuElement,
  theme: themeOverrides,
}: TimelineProps = {}) {
  const {
    onMoveElement,
    onMoveElements,
    onResizeElement,
    onResizeElements,
    onBlockedEditAttempt,
    onRazorSplitAll,
    onDeleteKeyframe,
    onDeleteAllKeyframes,
    onChangeKeyframeEase,
    onMoveKeyframeToPlayhead,
    onMoveKeyframe,
  } = useResolvedTimelineEditCallbacks({
    onMoveElement: onMoveElementOverride,
    onMoveElements: onMoveElementsOverride,
    onResizeElement: onResizeElementOverride,
    onResizeElements: onResizeElementsOverride,
    onBlockedEditAttempt: onBlockedEditAttemptOverride,
    onSplitElement: onSplitElementOverride,
  });
  const theme = useMemo(() => ({ ...defaultTimelineTheme, ...themeOverrides }), [themeOverrides]);
  useMusicBeatAnalysis();
  const rawElements = usePlayerStore((s) => s.elements);
  const expandedElements = useExpandedTimelineElements();
  const keyframeCache = usePlayerStore((s) => s.keyframeCache);
  const clipParentMap = usePlayerStore((s) => s.clipParentMap);
  const clipManifest = usePlayerStore((s) => s.clipManifest);
  const domClipChildren = usePlayerStore((s) => s.domClipChildren);
  const hasScenes = rawElements.some(isSceneTimelineElement);
  const layerMode = editingMode === "scene" || !hasScenes ? "scene" : "master";
  const scopedElements = useMemo(
    () =>
      inlineScope
        ? buildInlineScopeElements(
            rawElements,
            clipManifest ?? [],
            clipParentMap,
            domClipChildren,
            inlineScope,
            true,
          )
        : layerMode === "scene"
          ? collectTimelineTreeElements(rawElements, clipManifest ?? [], domClipChildren)
          : expandedElements,
    [inlineScope, rawElements, clipManifest, clipParentMap, domClipChildren, expandedElements, layerMode],
  );
  const expandableIds = useMemo(() => new Set(clipParentMap.values()), [clipParentMap]);
  const displayElements = useMemo(() => {
    const animatedKeys = new Set([...keyframeCache].filter(([, entry]) =>
      (entry.animationSegments?.length ?? 0) > 0 || entry.keyframes.length > 0 ||
      (entry.propertyAnimations?.length ?? 0) > 0).map(([key]) => key));
    if (layerMode === "scene") return toSceneLayerRows(presentFlatSceneLayers(
      scopedElements, clipParentMap, domClipChildren, animatedKeys, inlineScope,
    ));
    const visible = scopedElements.filter((element) => {
      if (
        !inlineScope &&
        editingMode === "master" &&
        (element.expandedParentStart !== undefined ||
          clipParentMap.has(element.domId ?? element.id))
      )
        return false;
      const elementKey = element.key ?? element.id;
      const cacheEntry =
        keyframeCache.get(elementKey) ??
        (element.domId ? keyframeCache.get(element.domId) : undefined);
      const hasAnimation =
        (cacheEntry?.animationSegments?.length ?? 0) > 0 || (cacheEntry?.keyframes.length ?? 0) > 0;
      return shouldDisplayTimelineElement(
        element,
        hasAnimation,
        expandableIds.has(element.domId ?? element.id),
      );
    });
    return toMasterSceneRows(visible);
  }, [
    editingMode,
    inlineScope,
    layerMode,
    clipParentMap,
    expandableIds,
    scopedElements,
    keyframeCache,
    domClipChildren,
  ]);
  const beatAnalysis = usePlayerStore((s) => s.beatAnalysis);
  const musicElement = usePlayerStore((s) => s.elements.find(isMusicTrack) ?? null);
  const beatEdits = usePlayerStore((s) => s.beatEdits);
  const adjustedBeatAnalysis = useMemo(
    () => remapBeatAnalysisToComposition(beatAnalysis, musicElement, beatEdits),
    [beatAnalysis, musicElement, beatEdits],
  );
  const duration = usePlayerStore((s) => s.duration);
  const timeDisplayMode = usePlayerStore((s) => s.timeDisplayMode);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const selectedElementIds = usePlayerStore((s) => s.selectedElementIds);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();

  const playheadRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTool = usePlayerStore((s) => s.activeTool);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const isDragging = useRef(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [razorGuideX, setRazorGuideX] = useState<number | null>(null);
  const [preferredGutterWidth, setPreferredGutterWidth] = useState(
    () => readStudioUiPreferences().timelineLayerWidth ?? DEFAULT_TIMELINE_GUTTER_WIDTH,
  );
  const gutterWidthRef = useRef(preferredGutterWidth);

  useMountEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(e.type === "keydown");
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  });

  const [showPopover, setShowPopover] = useState(false);
  const [kfContextMenu, setKfContextMenu] = useState<KeyframeDiamondContextMenuState | null>(null);
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);

  // Last horizontal scroll offset, restored across the post-edit iframe reload (pinned zoom).
  const lastScrollLeftRef = useRef(0);

  const effectiveDuration = useMemo(() => {
    if (visibleDuration != null) return visibleDuration;
    const safeDur = Number.isFinite(duration) ? duration : 0;
    if (rawElements.length === 0) return safeDur;
    const result = Math.max(safeDur, ...rawElements.map((el) => el.start + el.duration));
    return Number.isFinite(result) ? result : safeDur;
  }, [rawElements, duration, visibleDuration]);

  const { tracks, trackStyles, elementStyles, trackOrder } = useTimelineTrackDerivations(
    displayElements,
    "scene",
  );
  const [expandedLayerKeys, setExpandedLayerKeys] = useState(new Set<string>());
  const [revealedProperties, setRevealedProperties] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  const expandedLayerKeysRef = useRef(expandedLayerKeys);
  expandedLayerKeysRef.current = expandedLayerKeys;
  const pendingLayerToggle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledLayerProperties = useCallback(() => {
    if (pendingLayerToggle.current) clearTimeout(pendingLayerToggle.current);
    pendingLayerToggle.current = null;
  }, []);
  useEffect(() => cancelScheduledLayerProperties, [cancelScheduledLayerProperties]);
  const setLayerPropertiesExpanded = useCallback((element: TimelineElement, expanded: boolean) => {
    const key = element.key ?? element.id;
    const store = usePlayerStore.getState();
    if (!expanded && store.selectedPropertyKeyframe?.ownerKey === key)
      store.setSelectedPropertyKeyframe(null);
    setExpandedLayerKeys((previous) => {
      if (previous.has(key) === expanded) return previous;
      const next = new Set(previous);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const toggleLayerProperties = useCallback(
    (element: TimelineElement) => {
      cancelScheduledLayerProperties();
      setLayerPropertiesExpanded(
        element,
        !expandedLayerKeysRef.current.has(element.key ?? element.id),
      );
    },
    [cancelScheduledLayerProperties, setLayerPropertiesExpanded],
  );
  const scheduleLayerProperties = useCallback(
    (element: TimelineElement) => {
      cancelScheduledLayerProperties();
      // Selection can reveal the same effect before the click delay ends. Preserve
      // the user's opening/closing intent rather than toggling that newer state.
      const expanded = !expandedLayerKeysRef.current.has(element.key ?? element.id);
      pendingLayerToggle.current = setTimeout(() => {
        setLayerPropertiesExpanded(element, expanded);
        pendingLayerToggle.current = null;
      }, 250);
    },
    [cancelScheduledLayerProperties, setLayerPropertiesExpanded],
  );
  const selectedTimelineEffect = usePlayerStore((state) => state.selectedTimelineEffect);
  useEffect(() => {
    if (
      !selectedTimelineEffect ||
      !displayElements.some(
        (element) => (element.key ?? element.id) === selectedTimelineEffect.ownerKey,
      )
    )
      return;
    const { ownerKey, property } = selectedTimelineEffect;
    if (property) setRevealedProperties((previous) => {
      const properties = previous.get(ownerKey) ?? [];
      return properties.includes(property) ? previous : new Map(previous).set(ownerKey, [...properties, property]);
    });
    setExpandedLayerKeys((previous) =>
      previous.has(ownerKey) ? previous : new Set([...previous, ownerKey]),
    );
    const store = usePlayerStore.getState();
    if (!store.selectedPropertyKeyframe) store.requestClipReveal(ownerKey);
  }, [layerMode, selectedTimelineEffect, displayElements]);
  const presentationRows = useMemo(() => {
    const rows: TimelinePresentationRow[] = [];
    for (const [track, elements] of tracks) {
      const owner = resolveTimelineLayerPrimaryElement(elements, selectedElementId, currentTime);
      const elementKey = owner?.key ?? owner?.id ?? `track:${track}`;
      rows.push({ kind: "layer", key: elementKey, track, elementKey });
      if (!expandedLayerKeys.has(elementKey)) continue;
      const animations =
        keyframeCache.get(elementKey)?.propertyAnimations ??
        (owner?.domId ? keyframeCache.get(owner.domId)?.propertyAnimations : undefined) ??
        [];
      const properties = buildTimelinePropertyRows(animations, revealedProperties.get(elementKey));
      for (const property of properties) {
        rows.push({
          ...property,
          kind: property.kind,
          key: `${elementKey}:${property.key}`,
          track,
          elementKey,
        });
      }
    }
    return rows;
  }, [tracks, selectedElementId, currentTime, expandedLayerKeys, keyframeCache, revealedProperties]);
  const presentationRowsRef = useRef(presentationRows);
  presentationRowsRef.current = presentationRows;
  const presentationTrackOrder = useMemo(
    () => getTimelinePresentationTrackOrder(presentationRows),
    [presentationRows],
  );
  const presentationTrackOrderRef = useRef(presentationTrackOrder);
  presentationTrackOrderRef.current = presentationTrackOrder;
  const assetTrackOrder = useMemo(() => {
    const authoredByLane = new Map(
      tracks.map(([track, elements]) => [track, elements[0]?.authoredTrack ?? track]),
    );
    return presentationRows.map((row) => authoredByLane.get(row.track) ?? row.track);
  }, [tracks, presentationRows]);
  const assetTrackOrderRef = useRef(assetTrackOrder);
  assetTrackOrderRef.current = assetTrackOrder;
  const trackOrderRef = useRef(trackOrder);
  trackOrderRef.current = trackOrder;
  const expandedElementsRef = useRef(displayElements);
  expandedElementsRef.current = displayElements;

  const ppsRef = useRef(100);
  const timeOffsetRef = useRef(timeOffset);
  timeOffsetRef.current = timeOffset;
  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration;
  // Declared before the fitPps derivation so the edit-pin wrappers can close over it.
  const fitPpsRef = useRef(100);

  const {
    setRangeSelectionRef,
    pinnedOnMoveElement,
    pinnedOnMoveElements,
    pinnedOnResizeElement,
    pinnedOnResizeElements,
    pinnedOnFileDrop,
    pinnedOnAssetDrop,
    pinnedOnBlockDrop,
  } = useTimelineEditPinning({
    ppsRef,
    fitPpsRef,
    onMoveElement,
    onMoveElements,
    onResizeElement,
    onResizeElements,
    onFileDrop,
    onAssetDrop,
    onBlockDrop,
  });

  const { readClipZIndex, applyStackingPatches, zSyncEnabled } = useTimelineStackingSync({
    expandedElementsRef,
  });

  const {
    gapMenuModel,
    gapHighlight,
    setHoveredGapAction,
    openGapMenu,
    dismissGapMenu,
    closeTrackGap,
    closeAllTrackGaps,
  } = useTrackGapMenu({
    tracks,
    expandedElementsRef,
    trackOrderRef,
    onMoveElement: pinnedOnMoveElement,
    onMoveElements: pinnedOnMoveElements,
  });

  const {
    draggedClip,
    setDraggedClip,
    resizingClip,
    setResizingClip,
    blockedClipRef,
    suppressClickRef,
    syncClipDragAutoScroll,
    dragPreviewStore,
  } = useTimelineClipDrag({
    displayElementsRef: expandedElementsRef,
    presentationRowsRef,
    scrollRef,
    ppsRef,
    durationRef,
    timeOffsetRef,
    trackOrderRef,
    onMoveElement: pinnedOnMoveElement,
    onMoveElements: pinnedOnMoveElements,
    onResizeElement: pinnedOnResizeElement,
    onResizeElements: pinnedOnResizeElements,
    onBlockedEditAttempt,
    setShowPopover,
    setRangeSelectionRef,
    readZIndex: zSyncEnabled ? readClipZIndex : undefined,
    onStackingPatches: zSyncEnabled ? applyStackingPatches : undefined,
  });

  const { isDragOver, handleAssetDragOver, handleAssetDrop, clearDropPreview } =
    useTimelineAssetDrop({
      scrollRef,
      ppsRef,
      durationRef,
      trackOrderRef: assetTrackOrderRef,
      gutterWidthRef,
      onFileDrop: pinnedOnFileDrop,
      onAssetDrop: pinnedOnAssetDrop,
      onBlockDrop: pinnedOnBlockDrop,
    });

  const displayTrackOrder = useMemo(() => {
    if (!draggedClip?.started || trackOrder.includes(draggedClip.previewTrack)) return trackOrder;
    return [...trackOrder, draggedClip.previewTrack].sort((a, b) => a - b);
  }, [draggedClip, trackOrder]);

  const displayPresentationRows = useMemo<TimelinePresentationRow[]>(() => {
    if (displayTrackOrder.length === trackOrder.length) return presentationRows;
    return displayTrackOrder.flatMap((track) => {
      const existing = presentationRows.filter((row) => row.track === track);
      return existing.length > 0
        ? existing
        : [{ kind: "layer", key: `pending:${track}`, track, elementKey: `pending:${track}` }];
    });
  }, [displayTrackOrder, trackOrder, presentationRows]);
  const displayPresentationTrackOrder = useMemo(
    () => getTimelinePresentationTrackOrder(displayPresentationRows),
    [displayPresentationRows],
  );
  const totalH = getTimelineCanvasHeight(displayPresentationRows.length);
  const {
    viewportWidth,
    viewportHeight,
    scrollLeft,
    scrollTop,
    showShortcutHint,
    setScrollRef,
    syncScrollViewport,
  } = useTimelineScrollViewport(scrollRef, [timelineReady, displayElements.length, totalH]);
  const gutterWidth = clampTimelineGutterWidth(preferredGutterWidth, viewportWidth);
  const gutterMaxWidth = getTimelineGutterMaxWidth(viewportWidth);
  gutterWidthRef.current = gutterWidth;
  const selectedKeyframes = usePlayerStore((s) => s.selectedKeyframes);
  const toggleSelectedKeyframe = usePlayerStore((s) => s.toggleSelectedKeyframe);

  const selectedElement = useMemo(
    () =>
      displayElements.find((element) => (element.key ?? element.id) === selectedElementId) ?? null,
    [displayElements, selectedElementId],
  );
  const selectedElementRef = useRef<TimelineElement | null>(selectedElement);
  selectedElementRef.current = selectedElement;

  const {
    pps,
    fitPps,
    displayContentWidth,
    displayDuration,
    clipStateVersion,
    zoomModeRef,
    manualZoomPercentRef,
  } = useTimelineGeometry({
    viewportWidth,
    gutterWidth,
    effectiveDuration,
    timeOffset,
    scoped: visibleDuration != null,
    zoomMode,
    manualZoomPercent,
    ppsRef,
    fitPpsRef,
    draggedClip,
    resizingClip,
    expandedElements: displayElements,
    isDragging,
    scrollRef,
    lastScrollLeftRef,
  });

  const visibleWindow = useMemo(() => {
    const window = getTimelineVisibleWindow({
      scrollLeft,
      scrollTop,
      viewportWidth,
      viewportHeight,
      pps,
      trackCount: displayPresentationRows.length,
      displayDuration,
      gutterWidth,
    });
    return {
      ...window,
      startTime: window.startTime + timeOffset,
      endTime: window.endTime + timeOffset,
    };
  }, [
    displayDuration,
    timeOffset,
    displayPresentationRows.length,
    pps,
    scrollLeft,
    scrollTop,
    viewportHeight,
    viewportWidth,
    gutterWidth,
  ]);
  useTimelineRevealClip(scrollRef, {
    elements: displayElements,
    displayTrackOrder: displayPresentationTrackOrder,
    pps,
    timeOffset,
    gutterWidth,
  });

  const laneGapStrips = useTimelineGapHighlights({
    gapHighlight,
    tracks,
    selectedElementId,
    selectedElementIds,
    expandedElements: displayElements,
    dragActive: draggedClip?.started === true || resizingClip != null,
    displayDuration: displayDuration + timeOffset,
  });

  const { seekFromX, autoScrollDuringDrag, dragScrollRaf } = useTimelinePlayhead({
    playheadRef,
    scrollRef,
    ppsRef,
    durationRef,
    isDragging,
    currentTime,
    timeOffset,
    zoomMode,
    manualZoomPercent,
    zoomModeRef,
    manualZoomPercentRef,
    fitPps,
    fitPpsRef,
    effectiveDuration,
    pps,
    timelineReady,
    gutterWidth,
    elementsLength: displayElements.length,
    setZoomMode,
    setManualZoomPercent,
    onSeek,
  });
  useTimelineActiveClips({
    scrollRef,
    currentTime,
    clipStateVersion,
  });

  const {
    rangeSelection,
    setRangeSelection,
    shiftClickClipRef,
    marqueeRect,
    annotationOutline,
    isScrubbing,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    cancelRangeSelection,
  } = useTimelineRangeSelection({
    scrollRef,
    ppsRef,
    effectiveDuration,
    timeOffset,
    pps,
    onSeek,
    seekFromX,
    autoScrollDuringDrag,
    dragScrollRaf,
    isDragging,
    setShowPopover,
    elementsRef: expandedElementsRef,
    trackOrderRef: presentationTrackOrderRef,
    onSelectElement,
    gutterWidth,
  });
  setRangeSelectionRef.current = setRangeSelection; // stable ref consumed by useTimelineClipDrag

  const prevSelectedRef = useRef(selectedElementRef.current);
  // eslint-disable-next-line no-restricted-syntax, react-hooks/exhaustive-deps
  useEffect(() => {
    const prev = prevSelectedRef.current;
    const curr = selectedElementRef.current;
    prevSelectedRef.current = curr;
    if (prev && !curr) {
      setShowPopover(false);
      setRangeSelection(null);
    }
  });

  // Frame display mode labels ruler ticks as frame numbers — pass the fps so ticks snap to frames.
  const tickFps = timeDisplayMode === "frame" || pps >= 100 ? STUDIO_PREVIEW_FPS : undefined;
  const { major, minor } = useMemo(
    () => generateTicks(displayDuration, pps, tickFps),
    [displayDuration, pps, tickFps],
  );
  const majorTickInterval = major.length >= 2 ? major[1] - major[0] : effectiveDuration;

  const getPreviewElement = useCallback(
    (element: TimelineElement): TimelineElement => {
      if (
        resizingClip &&
        (resizingClip.element.key ?? resizingClip.element.id) === (element.key ?? element.id)
      ) {
        return {
          ...element,
          start: resizingClip.previewStart,
          duration: resizingClip.previewDuration,
          playbackStart: resizingClip.previewPlaybackStart,
        };
      }
      return element;
    },
    [resizingClip],
  );

  if (!timelineReady || displayElements.length === 0) {
    return (
      <TimelineEmptyState
        isDragOver={isDragOver}
        onFileDrop={!!onFileDrop}
        onDragOver={handleAssetDragOver}
        onDragLeave={() => clearDropPreview()}
        onDrop={handleAssetDrop}
      />
    );
  }

  return (
    <div
      ref={setContainerRef}
      aria-label="Timeline"
      className={`hf-timeline-root relative border-t select-none h-full overflow-hidden ${activeTool === "razor" || activeTool === "annotate" || activeTool === "annotate-lasso" || shiftHeld ? "cursor-crosshair" : "cursor-default"}`}
      onMouseMove={(e) => {
        if (activeTool === "razor" && scrollRef.current) {
          const rect = scrollRef.current.getBoundingClientRect();
          setRazorGuideX(e.clientX - rect.left + scrollRef.current.scrollLeft);
        }
      }}
      onMouseLeave={() => setRazorGuideX(null)}
      style={{
        touchAction: "pan-x pan-y",
        background: theme.shellBackground,
        borderColor: theme.shellBorder,
      }}
    >
      <div
        ref={setScrollRef}
        tabIndex={-1}
        className={`hf-timeline-scroll ${activeTool === "annotate-lasso" ? "hf-annotation-drawing" : ""} ${zoomMode === "fit" ? "overflow-x-hidden" : "overflow-x-auto"} overflow-y-auto h-full outline-none`}
        style={{
          touchAction:
            activeTool === "annotate" || activeTool === "annotate-lasso" ? "none" : undefined,
        }}
        onScroll={(e) => {
          lastScrollLeftRef.current = e.currentTarget.scrollLeft; // restored across post-edit reload
          syncScrollViewport(e.currentTarget);
        }}
        onDragOver={handleAssetDragOver}
        onDragLeave={() => clearDropPreview()}
        onDrop={handleAssetDrop}
        onPointerDownCapture={(event) => {
          if (event.target instanceof Element && event.target.closest(".hf-timeline-ruler-gutter nav")) return;
          // Own the gesture before clip trim, animation, or drag handlers can run.
          if ((activeTool !== "annotate" && activeTool !== "annotate-lasso") || event.button !== 0)
            return;
          event.preventDefault();
          event.stopPropagation();
          handlePointerDown(event);
        }}
        onPointerDown={(e) => {
          if (activeTool === "razor" && e.shiftKey && e.button === 0 && scrollRef.current) {
            const rect = scrollRef.current.getBoundingClientRect();
            const x =
              e.clientX - rect.left + scrollRef.current.scrollLeft - gutterWidth - TRACKS_LEFT_PAD;
            const splitTime = timeOffset + Math.max(0, Math.min(effectiveDuration, x / pps));
            onRazorSplitAll?.(splitTime);
            return;
          }
          handlePointerDown(e);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelRangeSelection}
        onLostPointerCapture={handlePointerUp}
      >
        <TimelineCanvas
          navigation={navigation}
          editingMode={layerMode}
          presentationRows={displayPresentationRows}
          expandedLayerKeys={expandedLayerKeys}
          onToggleLayerProperties={toggleLayerProperties}
          onScheduleLayerProperties={scheduleLayerProperties}
          onCancelScheduledLayerProperties={cancelScheduledLayerProperties}
          major={major}
          minor={minor}
          pps={pps}
          timeOffset={timeOffset}
          trackContentWidth={displayContentWidth}
          gutterWidth={gutterWidth}
          totalH={totalH}
          effectiveDuration={effectiveDuration}
          majorTickInterval={majorTickInterval}
          rangeSelection={rangeSelection}
          marqueeRect={marqueeRect}
          annotationOutline={annotationOutline}
          laneGapStrips={laneGapStrips}
          visibleWindow={visibleWindow}
          theme={theme}
          displayTrackOrder={displayPresentationTrackOrder}
          trackOrder={trackOrder}
          tracks={tracks}
          trackStyles={trackStyles}
          elementStyles={elementStyles}
          selectedElementId={selectedElementId}
          selectedElementIds={selectedElementIds}
          hoveredClip={hoveredClip}
          draggedClip={draggedClip}
          dragPreviewStore={dragPreviewStore}
          resizingClip={resizingClip}
          isScrubbing={isScrubbing}
          blockedClipRef={blockedClipRef}
          suppressClickRef={suppressClickRef}
          scrollRef={scrollRef}
          renderClipContent={renderClipContent}
          renderClipOverlay={renderClipOverlay}
          playheadRef={playheadRef}
          onDrillDown={onDrillDown}
          onSeek={onSeek}
          onSelectElement={onSelectElement}
          onContextMenuElement={onContextMenuElement}
          setHoveredClip={setHoveredClip}
          setShowPopover={setShowPopover}
          setRangeSelection={setRangeSelection}
          setResizingClip={setResizingClip}
          setDraggedClip={setDraggedClip}
          setSelectedElementId={setSelectedElementId}
          syncClipDragAutoScroll={syncClipDragAutoScroll}
          shiftClickClipRef={shiftClickClipRef}
          getPreviewElement={getPreviewElement}
          getTrackStyle={getTrackStyle}
          keyframeCache={keyframeCache}
          selectedKeyframes={selectedKeyframes}
          currentTime={currentTime}
          beatAnalysis={adjustedBeatAnalysis}
          onClickKeyframe={(el, pct) => {
            usePlayerStore.getState().clearSelectedKeyframes();
            const elKey = el.key ?? el.id;
            setSelectedElementId(elKey);
            onSelectElement?.(el);
            // Select the clicked diamond (matches shift-click); cleared above so this single-selects.
            toggleSelectedKeyframe(`${elKey}:${pct}`);
            const absTime = roundTo3(el.start + (pct / 100) * el.duration);
            onSeek?.(absTime);
            const kfData = keyframeCache?.get(elKey);
            const kf = kfData?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.5);
            usePlayerStore.getState().setActiveKeyframePct(kf?.tweenPercentage ?? null);
          }}
          onShiftClickKeyframe={(elId, pct) => {
            toggleSelectedKeyframe(`${elId}:${pct}`);
          }}
          onMoveKeyframe={onMoveKeyframe}
          onContextMenuKeyframe={(e, elId, pct) => {
            const el = displayElements.find((x) => (x.key ?? x.id) === elId);
            if (el) {
              setSelectedElementId(elId);
              onSelectElement?.(el);
            }
            const kfData = keyframeCache.get(elId);
            const kf = kfData?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.2);
            setKfContextMenu({
              x: e.clientX + 4,
              y: e.clientY + 2,
              elementId: elId,
              percentage: pct,
              tweenPercentage: kf?.tweenPercentage,
              currentEase: kf?.ease ?? kfData?.ease,
            });
          }}
          onContextMenuLane={(e, track, time) => {
            if (draggedClip?.started || resizingClip) return;
            openGapMenu({ x: e.clientX, y: e.clientY, track, time });
          }}
        />
        {activeTool === "razor" && razorGuideX !== null && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-10"
            style={{
              left: razorGuideX,
              width: 1,
              background: "rgba(239,68,68,0.7)",
            }}
          />
        )}
      </div>
      <TimelineLayerResizeHandle
        width={gutterWidth}
        viewportWidth={viewportWidth}
        maxWidth={gutterMaxWidth}
        containerRef={containerRef}
        onWidthChange={setPreferredGutterWidth}
        onCommit={(width) => writeStudioUiPreferences({ timelineLayerWidth: width })}
      />
      {(activeTool === "annotate" || activeTool === "annotate-lasso") && !rangeSelection && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-10 z-30 -translate-x-1/2 whitespace-nowrap rounded-xl border border-panel-border bg-panel-bg px-3 py-2 text-xs text-panel-text-2 shadow-lg"
        >
          {activeTool === "annotate-lasso"
            ? "用画笔圈住片段，松开后填写 AI 批注"
            : "在片段内拖选部分时段；空白处拖选时间范围"}{" "}
          · Esc 取消
        </div>
      )}
      <TimelineOverlays
        theme={theme}
        showShortcutHint={showShortcutHint}
        showPopover={showPopover}
        rangeSelection={rangeSelection}
        onCloseRangeSelection={cancelRangeSelection}
        kfContextMenu={kfContextMenu}
        setKfContextMenu={setKfContextMenu}
        onDeleteKeyframe={onDeleteKeyframe}
        onDeleteAllKeyframes={onDeleteAllKeyframes}
        onChangeKeyframeEase={onChangeKeyframeEase}
        onMoveKeyframeToPlayhead={onMoveKeyframeToPlayhead}
        keyframeCache={keyframeCache}
        gapContextMenu={gapMenuModel}
        onDismissGapContextMenu={dismissGapMenu}
        onCloseTrackGap={closeTrackGap}
        onCloseAllTrackGaps={closeAllTrackGaps}
        onHoverGapAction={setHoveredGapAction}
      />
    </div>
  );
});
