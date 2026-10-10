import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { readStudioBoxSize, readStudioPathOffset, readStudioRotation } from "./manualEdits";
import {
  EMPTY_STYLES,
  parsePxMetricValue,
  readGsapRuntimeValuesForPanel,
  readGsapBorderRadiusForPanel,
  selectionIdentityKey,
} from "./propertyPanelHelpers";
import { createTransformCommitHandlers } from "./propertyPanelTransformCommit";
import { classifyPropertyGroup } from "@hyperframes/core/gsap-parser";
import { resolveEditingSections } from "@hyperframes/core/editing";
import { domEditSelectionToFacts } from "./domEditingLayers";
import { PropertyPanelFlat } from "./PropertyPanelFlat";
import { usePlayerStore, liveTime } from "../../player";
import { type PropertyPanelProps } from "./propertyPanelHelpers";
import { PropertyPanelEmptyState } from "./PropertyPanelEmptyState";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";

// Re-export helpers that external consumers import from this module
export {
  buildInsetClipPathSides,
  buildStrokeStyleUpdates,
  buildStrokeWidthStyleUpdates,
  getCssFilterFunctionPx,
  getClipPathInsetPx,
  inferBoxShadowPreset,
  inferClipPathPreset,
  normalizePanelPxValue,
  parseInsetClipPathSides,
  setCssFilterFunctionPx,
} from "./propertyPanelHelpers";

// fallow-ignore-next-line complexity
export const PropertyPanel = memo(function PropertyPanel(props: PropertyPanelProps) {
  const {
    element,
    multiSelectCount = 0,
    multiSelectedElements,
    onGroupSelection,
    onHideAllSelected,
    onClearSelection,
    onSetManualOffset,
    onSetManualSize,
    onSetManualRotation,
    previewIframeRef,
    gsapAnimations = [],
    onCommitAnimatedProperty,
    onAddKeyframe,
  } = props;
  const styles = element?.computedStyles ?? EMPTY_STYLES;
  const { showToast } = useStudioShellContext();
  // The inspector's empty state has no time-dependent content. Returning
  // stable selector values here keeps opening Properties during playback from
  // subscribing the empty panel to player ticks or timeline-array updates.
  const storeTime = usePlayerStore((s) => (element ? s.currentTime : 0));
  const isPlaying = usePlayerStore((s) => (element ? s.isPlaying : false));
  const liveTimeRef = useRef(storeTime);
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!isPlaying || !element) return;
    let timerId: ReturnType<typeof setTimeout> | 0 = 0;
    const unsub = liveTime.subscribe((t) => {
      liveTimeRef.current = t;
      if (!timerId)
        timerId = setTimeout(() => {
          timerId = 0;
          forceRender((v) => v + 1);
        }, 33);
    });
    return () => {
      unsub();
      if (timerId) clearTimeout(timerId);
    };
  }, [isPlaying, element]);
  const currentTime = isPlaying ? liveTimeRef.current : storeTime;
  const cacheElementKey = element?.id ?? element?.selector ?? "";
  const cacheEntry = usePlayerStore((s) => s.keyframeCache.get(cacheElementKey));

  const iframeRef = previewIframeRef ?? { current: null };
  const gsapAnimIdForMemo = element
    ? (gsapAnimations?.find((a: { keyframes?: unknown }) => a.keyframes)?.id ??
      gsapAnimations?.[0]?.id ??
      null)
    : null;
  const gsapRuntimeValues = useMemo(
    () =>
      element
        ? readGsapRuntimeValuesForPanel(gsapAnimIdForMemo, gsapAnimations, element, iframeRef)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iframeRef is stable; currentTime drives re-reads during playback
    [gsapAnimIdForMemo, gsapAnimations, element, currentTime],
  );
  const gsapBorderRadius = useMemo(
    () =>
      element
        ? readGsapBorderRadiusForPanel(gsapRuntimeValues, gsapAnimations, element, iframeRef)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gsapRuntimeValues, gsapAnimations, element, currentTime],
  );
  // The 3D Transform panel should be reachable on ANY element, not only ones GSAP is
  // already animating — otherwise you can't add depth/rotation to a fresh static
  // element (the panel never appears, the classic chicken-and-egg). Default to
  // identity when there are no runtime values yet; the first edit creates the
  // gsap.set via commitStaticSet, after which real runtime values flow in.
  const gsap3dValues: Record<string, number> = gsapRuntimeValues ?? {
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    z: 0,
    scale: 1,
    transformPerspective: 0,
  };

  if (!element) {
    return (
      <PropertyPanelEmptyState
        multiSelectCount={multiSelectCount}
        multiSelectedElements={multiSelectedElements}
        onGroupSelection={onGroupSelection}
        onHideAllSelected={onHideAllSelected}
        onClearSelection={onClearSelection}
      />
    );
  }

  const manualOffsetEditingDisabled = !element.capabilities.canApplyManualOffset;
  const manualSizeEditingDisabled = !element.capabilities.canApplyManualSize;
  const manualRotationEditingDisabled = !element.capabilities.canApplyManualRotation;
  const sourceLabel = element.id ? `#${element.id}` : (element.selector ?? "");
  // Capabilities are already resolved on the selection; recompute only sections,
  // feeding the live GSAP tween count (arrives on the gsapAnimations prop, not the
  // selection) so the Timing section shows for pure-GSAP elements with no data-start.
  const sections = resolveEditingSections(domEditSelectionToFacts(element, gsapAnimations.length));
  const showEditableSections = element.capabilities.canEditStyles && sections.style;
  const manualOffset = readStudioPathOffset(element.element);
  const manualSize = readStudioBoxSize(element.element);
  const resolvedWidth =
    manualSize.width > 0
      ? manualSize.width
      : (parsePxMetricValue(styles.width ?? "") ?? element.boundingBox.width);
  const resolvedHeight =
    manualSize.height > 0
      ? manualSize.height
      : (parsePxMetricValue(styles.height ?? "") ?? element.boundingBox.height);

  const manualRotation = readStudioRotation(element.element);

  const elementTiming = deriveElementTiming(element, gsapAnimations);
  const elStart = elementTiming.start;
  const elDuration = elementTiming.duration;
  const currentPct = elDuration > 0 ? ((currentTime - elStart) / elDuration) * 100 : 0;

  const gsapKfAnim = gsapAnimations?.find((a) => a.keyframes) ?? null;
  const gsapKeyframes = gsapKfAnim?.keyframes?.keyframes ?? null;
  const gsapAnimId = gsapKfAnim?.id ?? gsapAnimations?.[0]?.id ?? null;
  const hasGsapAnimation = !!(gsapAnimId || gsapAnimations.length > 0);
  const { commitManualOffset, commitManualSize, commitManualRotation } =
    createTransformCommitHandlers({
      element,
      styles,
      hasGsapAnimation,
      gsapAnimId,
      gsapKeyframes,
      currentPct,
      onCommitAnimatedProperty,
      onAddKeyframe,
      onSetManualOffset,
      onSetManualSize,
      onSetManualRotation,
      showToast,
    });
  const navKeyframes = cacheEntry?.keyframes ?? gsapKeyframes;

  const animIdForProp = (prop: string): string => {
    const group = classifyPropertyGroup(prop);
    const groupAnim = gsapAnimations?.find((a) => a.propertyGroup === group);
    if (groupAnim) return groupAnim.id;
    return gsapAnimId ?? "";
  };

  const displayX = gsapRuntimeValues?.x ?? manualOffset.x;
  const displayY = gsapRuntimeValues?.y ?? manualOffset.y;
  const displayW = gsapRuntimeValues?.width ?? resolvedWidth;
  const displayH = gsapRuntimeValues?.height ?? resolvedHeight;
  const displayR = gsapRuntimeValues?.rotation ?? manualRotation.angle;

  return (
    <PropertyPanelFlat
      {...props}
      key={selectionIdentityKey(element)}
      element={element}
      styles={styles}
      sections={sections}
      sourceLabel={sourceLabel}
      gsapBorderRadius={gsapBorderRadius}
      showEditableSections={showEditableSections}
      displayX={displayX}
      displayY={displayY}
      displayW={displayW}
      displayH={displayH}
      displayR={displayR}
      manualOffsetEditingDisabled={manualOffsetEditingDisabled}
      manualSizeEditingDisabled={manualSizeEditingDisabled}
      manualRotationEditingDisabled={manualRotationEditingDisabled}
      commitManualOffset={commitManualOffset}
      commitManualSize={commitManualSize}
      commitManualRotation={commitManualRotation}
      gsapAnimId={gsapAnimId}
      navKeyframes={navKeyframes}
      currentTime={currentTime}
      animIdForProp={animIdForProp}
      gsapRuntimeValues={gsap3dValues}
      elStart={elStart}
      elDuration={elDuration}
    />
  );
});
