import { type ReactNode, useEffect, useRef, useState } from "react";
import { resolveEditingSections } from "@hyperframes/core/editing";
import { DesignPanelInputProvider } from "../../contexts/DesignPanelInputContext";
import { slugifyDesignInput } from "../../utils/designInputTracking";
import type { DomEditSelection } from "./domEditing";
import { isTextEditableSelection } from "./domEditing";
import type { PropertyPanelProps } from "./propertyPanelHelpers";
import { formatPxMetricValue, inferMaskShape } from "./propertyPanelHelpers";
import { PropertyPanelFlatHeader } from "./PropertyPanelFlatHeader";
import { PropertyPanelFlatFooter } from "./PropertyPanelFlatFooter";
import { FlatGroupHeader } from "./propertyPanelFlatPrimitives";
import { FlatTextSection } from "./propertyPanelFlatTextSection";
import {
  FlatAppearanceSection,
  FlatFillSection,
  FlatStrokeSection,
} from "./propertyPanelFlatStyleSections";
import { FlatMaskSection } from "./propertyPanelFlatMaskSection";
import { FlatLayoutSection, LayoutTransform3DBlock } from "./propertyPanelFlatLayoutSection";
import { FlatMotionSection, FlatTimingRow } from "./propertyPanelFlatMotionSection";
import { FlatMediaSection } from "./propertyPanelFlatMediaSection";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";
import { createGsapLivePreview } from "./gsapLivePreview";
import { formatTextFieldPreview } from "./propertyPanelSections";
import { STUDIO_GSAP_PANEL_ENABLED } from "./manualEditingAvailability";
import { useColorGradingController } from "./useColorGradingController";
import {
  FlatColorGradingAccessory,
  FlatColorGradingSection,
} from "./propertyPanelFlatColorGradingSection";

type EditingSections = ReturnType<typeof resolveEditingSections>;

type FlatGroupDescriptor = {
  id: string;
  title: string;
  summary: string;
  accessory?: ReactNode;
  content: ReactNode;
};

export type InspectorElementKind = "text" | "image" | "video" | "audio" | "other";

const INSPECTOR_GROUP_PRIORITIES: Record<InspectorElementKind, readonly string[]> = {
  text: [
    "text",
    "layout",
    "fill",
    "appearance",
    "stroke",
    "mask",
    "timing",
    "transform-3d",
    "grade",
    "media",
  ],
  image: [
    "layout",
    "mask",
    "appearance",
    "media",
    "grade",
    "fill",
    "stroke",
    "timing",
    "transform-3d",
    "text",
  ],
  video: [
    "media",
    "mask",
    "layout",
    "appearance",
    "grade",
    "timing",
    "fill",
    "stroke",
    "transform-3d",
    "text",
  ],
  audio: ["media", "timing"],
  other: [
    "layout",
    "fill",
    "appearance",
    "stroke",
    "mask",
    "timing",
    "transform-3d",
    "text",
    "media",
    "grade",
  ],
};

export function resolveInspectorElementKind(
  tagName: string,
  isTextEditable: boolean,
): InspectorElementKind {
  const normalizedTag = tagName.toLowerCase();
  if (normalizedTag === "img") return "image";
  if (normalizedTag === "video") return "video";
  if (normalizedTag === "audio") return "audio";
  return isTextEditable ? "text" : "other";
}

export function resolveInspectorGroupOrder({
  elementKind,
  hasAnimationParameters,
  availableGroupIds,
}: {
  elementKind: InspectorElementKind;
  hasAnimationParameters: boolean;
  availableGroupIds: readonly string[];
}): string[] {
  const available = new Set(availableGroupIds);
  const ordered: string[] = [];
  const priorities = hasAnimationParameters
    ? ["animation", ...INSPECTOR_GROUP_PRIORITIES[elementKind]]
    : INSPECTOR_GROUP_PRIORITIES[elementKind];

  for (const groupId of priorities) {
    if (available.has(groupId) && !ordered.includes(groupId)) ordered.push(groupId);
  }
  for (const groupId of availableGroupIds) {
    if (!ordered.includes(groupId)) ordered.push(groupId);
  }
  return ordered;
}

export function resolveOpenInspectorGroup({
  currentGroupId,
  orderedGroupIds,
  hasManualSelection,
}: {
  currentGroupId: string;
  orderedGroupIds: readonly string[];
  hasManualSelection: boolean;
}): string {
  if (
    hasManualSelection &&
    (currentGroupId === "" || orderedGroupIds.includes(currentGroupId))
  ) {
    return currentGroupId;
  }
  return orderedGroupIds[0] ?? "";
}

/**
 * The flat "Ledger" inspector shell (design_handoff_studio_inspector).
 *
 * Extracted from PropertyPanel so that file stays under the 600-LOC gate
 * (same one-directional-import precedent as FlatTextSection). Rendered only
 * when STUDIO_FLAT_INSPECTOR_ENABLED is on; owns the one-open group state.
 *
 * The Text/Style/Layout/Motion/Media/Grade groups share the one-open accordion.
 */
// fallow-ignore-next-line complexity
export function PropertyPanelFlat({
  element,
  inspectorMode = "properties",
  showInspectorChrome = true,
  styles,
  sections,
  sourceLabel,
  gsapAnimations = [],
  gsapBorderRadius,
  fontAssets = [],
  showEditableSections,
  projectId,
  projectDir,
  assets,
  previewIframeRef,
  onSetStyle,
  onSetAttribute,
  onSetAttributes,
  onSetAttributeLive,
  onApplyColorGradingScope,
  onSetHtmlAttribute,
  onRemoveBackground,
  onSetText,
  onSetTextFieldStyle,
  onAddTextField,
  onRemoveTextField,
  onAskAgent,
  onImportAssets,
  onImportFonts,
  recordingState,
  recordingDuration,
  onToggleRecording,
  displayX,
  displayY,
  displayW,
  displayH,
  displayR,
  manualOffsetEditingDisabled,
  manualSizeEditingDisabled,
  manualRotationEditingDisabled,
  commitManualOffset,
  commitManualSize,
  commitManualRotation,
  gsapAnimId,
  navKeyframes,
  currentTime,
  animIdForProp,
  gsapRuntimeValues,
  // Renamed: PropertyPanel.tsx still computes/passes these for its own legacy
  // (non-flat) panel, but the flat path recomputes its own basis below via
  // deriveElementTiming so it agrees with Motion's Timing row — ignore the
  // parent's naive `elDuration ?? 1` fallback.
  elStart: _elStart,
  elDuration: _elDuration,
  onCommitAnimatedProperty,
  onCommitAnimatedProperties,
  onSeekToTime,
  onRemoveKeyframe,
  onConvertToKeyframes,
  gsapMultipleTimelines,
  gsapUnsupportedTimelinePattern,
  onMutateMotion,
}: Pick<
  PropertyPanelProps,
  | "projectId"
  | "projectDir"
  | "assets"
  | "inspectorMode"
  | "showInspectorChrome"
  | "previewIframeRef"
  | "onSetStyle"
  | "onSetAttribute"
  | "onSetAttributes"
  | "onSetAttributeLive"
  | "onApplyColorGradingScope"
  | "onSetHtmlAttribute"
  | "onRemoveBackground"
  | "onSetText"
  | "onSetTextFieldStyle"
  | "onAddTextField"
  | "onRemoveTextField"
  | "onAskAgent"
  | "onImportAssets"
  | "onImportFonts"
  | "fontAssets"
  | "gsapAnimations"
  | "gsapMultipleTimelines"
  | "gsapUnsupportedTimelinePattern"
  | "onUpdateGsapProperty"
  | "onUpdateGsapMeta"
  | "onDeleteGsapAnimation"
  | "onAddGsapProperty"
  | "onRemoveGsapProperty"
  | "onUpdateGsapFromProperty"
  | "onAddGsapFromProperty"
  | "onRemoveGsapFromProperty"
  | "onAddGsapAnimation"
  | "onMutateMotion"
  | "onSetArcPath"
  | "onUpdateArcSegment"
  | "onUnroll"
  | "onUpdateKeyframeEase"
  | "onSetAllKeyframeEases"
  | "recordingState"
  | "recordingDuration"
  | "onToggleRecording"
> &
  // Layout-group values (Plan 3a Task 5). All are derived locals or handlers in
  // PropertyPanel; compose their exact shapes from FlatLayoutSection's own props
  // via Pick so a signature change there propagates here instead of drifting.
  Pick<
    Parameters<typeof FlatLayoutSection>[0],
    | "displayX"
    | "displayY"
    | "displayW"
    | "displayH"
    | "displayR"
    | "manualOffsetEditingDisabled"
    | "manualSizeEditingDisabled"
    | "manualRotationEditingDisabled"
    | "commitManualOffset"
    | "commitManualSize"
    | "commitManualRotation"
    | "gsapAnimId"
    | "navKeyframes"
    | "animIdForProp"
    | "gsapRuntimeValues"
    | "elStart"
    | "elDuration"
    | "onCommitAnimatedProperty"
    | "onCommitAnimatedProperties"
    | "onSeekToTime"
    | "onRemoveKeyframe"
    | "onConvertToKeyframes"
  > & {
    element: DomEditSelection;
    styles: Record<string, string>;
    sections: EditingSections;
    sourceLabel: string;
    gsapBorderRadius: { tl: number; tr: number; br: number; bl: number } | null;
    showEditableSections: boolean;
    currentTime: number;
  }) {
  // Slider drags update the live iframe element directly; durable source
  // persistence is deferred to pointer release by FlatSlider.
  const previewInlineStyle = (property: string, value: string) => {
    element.element.style.setProperty(property, value);
  };
  const isTextEditable = isTextEditableSelection(element);
  const elementKind = resolveInspectorElementKind(element.tagName, isTextEditable);
  const headerElementKind =
    elementKind === "text"
      ? "text"
      : elementKind === "image" || elementKind === "video" || elementKind === "audio"
        ? "media"
        : "other";
  const hasAnimationParameters =
    STUDIO_GSAP_PANEL_ENABLED && Boolean(onMutateMotion);
  const showMotionTiming = Boolean(sections.timing);
  const gsapEffectHandlers =
    hasAnimationParameters && onMutateMotion ? { onMutateMotion } : null;
  const showMotionEffects = inspectorMode === "animation" && gsapEffectHandlers !== null;
  const availableGroupIds =
    inspectorMode === "animation"
      ? [...(showMotionEffects ? ["animation"] : [])]
      : [
          ...(showMotionTiming ? ["timing"] : []),
          ...(isTextEditable ? ["text"] : []),
          ...(showEditableSections ? ["fill", "stroke", "appearance", "mask"] : []),
          ...(sections.layout ? ["layout", "transform-3d"] : []),
          ...(sections.colorGrading ? ["grade"] : []),
          ...(sections.media ? ["media"] : []),
        ];
  const orderedGroupIds = resolveInspectorGroupOrder({
    elementKind,
    hasAnimationParameters: showMotionEffects,
    availableGroupIds,
  });
  const orderedGroupKey = orderedGroupIds.join("|");
  const [openGroupId, setOpenGroupId] = useState<string>(() =>
    resolveOpenInspectorGroup({
      currentGroupId: "",
      orderedGroupIds,
      hasManualSelection: false,
    }),
  );
  const hasManualGroupSelectionRef = useRef(false);
  useEffect(() => {
    setOpenGroupId((currentGroupId) =>
      resolveOpenInspectorGroup({
        currentGroupId,
        orderedGroupIds: orderedGroupKey ? orderedGroupKey.split("|") : [],
        hasManualSelection: hasManualGroupSelectionRef.current,
      }),
    );
  }, [orderedGroupKey]);

  // Tracks which group(s) are actively transitioning this toggle cycle, so
  // their header/body gets the fast entrance animation (hf-flat-group-enter)
  // and no one else's does. Deliberately NOT derived from remounting alone:
  // FlatGroupHeader instances are keyed by group id and React normally
  // preserves them across re-renders, but toggling a non-adjacent group still
  // shifts the untouched collapsed siblings between the before/after-open
  // slices below, and Chromium restarts a CSS animation on that kind of
  // position shift even though nothing about the sibling actually changed.
  // Gating on these ids (cleared shortly after the 120ms CSS animation
  // finishes) keeps the animation scoped to only the groups that actually
  // just toggled. Two ids, not one: the clicked (newly-opening/closing) group
  // AND whichever group was open immediately before the click and got
  // implicitly closed by it — both freshly-mounted headers need to animate.
  const [justToggledIds, setJustToggledIds] = useState<string[]>([]);
  const justToggledTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (justToggledTimeoutRef.current) clearTimeout(justToggledTimeoutRef.current);
    };
  }, []);

  // Grade group state. Called unconditionally (React rules-of-hooks) even when
  // sections.colorGrading is false — unlike the legacy ColorGradingSection,
  // which is only mounted when the section is active, PropertyPanelFlat is not
  // remounted per-section so the hook must run every render. Shares one state
  // object between the group's header accessory (compare/status/reset) and its
  // body (the FlatColorGradingSection controls).
  const colorGradingController = useColorGradingController({
    projectId,
    element,
    previewIframeRef,
    onSetAttributeLive,
    onApplyScope: onApplyColorGradingScope,
  });

  const toggleOpen = (groupId: string) => {
    hasManualGroupSelectionRef.current = true;
    // Capture what was open BEFORE this click (this render's closure over
    // openGroupId), so the group that's about to be implicitly closed can be
    // tracked too — not just the one the user clicked.
    const previousOpenGroupId = openGroupId;
    setOpenGroupId((current) => (current === groupId ? "" : groupId));
    const implicitlyClosedId =
      previousOpenGroupId && previousOpenGroupId !== groupId ? previousOpenGroupId : null;
    setJustToggledIds(implicitlyClosedId ? [groupId, implicitlyClosedId] : [groupId]);
    if (justToggledTimeoutRef.current) clearTimeout(justToggledTimeoutRef.current);
    justToggledTimeoutRef.current = setTimeout(() => setJustToggledIds([]), 200);
  };
  // Basis for the Layout keyframe gutter (X/Y/W/H/Angle + 3D Transform) —
  // must agree with Motion's Timing row (FlatTimingRow), which infers the
  // range from animations when there's no explicit data-duration. Computed
  // here (not threaded from PropertyPanel) both to keep that file under its
  // 600-LOC gate and because element/gsapAnimations are already in scope.
  const { start: elStart, duration: elDuration } = deriveElementTiming(element, gsapAnimations);
  // Trivial percentage→time seek, derived here rather than threaded from
  // PropertyPanel (keeps that file under its 600-LOC gate).
  const seekFromKfPct = (pct: number) => onSeekToTime?.(elStart + (pct / 100) * elDuration);
  // Playhead position within the SAME corrected elStart/elDuration basis as
  // seekFromKfPct above — recomputed here (not threaded as `currentPct` from
  // PropertyPanel, which still derives it against its own naive basis for the
  // legacy panel) so KeyframeNavigation's diamond active-state and prev/next
  // arrow targeting agree with where a keyframe click actually seeks to
  // (follow-up fix to 684ec4e87, which corrected the seek basis but left this
  // one still naive).
  const currentPct = elDuration > 0 ? ((currentTime - elStart) / elDuration) * 100 : 0;
  const parsedOpacity = Number.parseFloat(styles.opacity ?? "1");
  const opacityPercent = Math.round((Number.isFinite(parsedOpacity) ? parsedOpacity : 1) * 100);

  // Ordered group descriptors — one per FlatGroup this panel renders, gated by
  // the same conditions the inline JSX used. Split below into before-open/
  // open/after-open regions for the one-open accordion.
  const groups: FlatGroupDescriptor[] = [];
  if (showMotionTiming) {
    groups.push({
      id: "timing",
      title: "Timing",
      summary: `${elDuration.toFixed(2)}s · 2 parameters`,
      content: (
        <FlatTimingRow
          element={element}
          animations={gsapAnimations}
          currentTime={currentTime}
          onSetAttribute={onSetAttribute}
          onSetAttributes={onSetAttributes}
          onSeekToTime={onSeekToTime}
        />
      ),
    });
  }
  if (isTextEditable) {
    groups.push({
      id: "text",
      title: "Text",
      summary: formatTextFieldPreview(element.textFields[0]?.value ?? ""),
      content: (
        <FlatTextSection
          element={element}
          styles={styles}
          fontAssets={fontAssets}
          onImportFonts={onImportFonts}
          onSetText={onSetText}
          onSetTextFieldStyle={onSetTextFieldStyle}
          onAddTextField={onAddTextField}
          onRemoveTextField={onRemoveTextField}
        />
      ),
    });
  }
  if (showEditableSections) {
    groups.push({
      id: "fill",
      title: "Fill",
      summary:
        styles["background-image"] && styles["background-image"] !== "none"
          ? "Image fill"
          : styles["background-color"] || "Color · image",
      content: (
        <FlatFillSection
          projectId={projectId}
          element={element}
          styles={styles}
          assets={assets}
          onSetStyle={onSetStyle}
          onImportAssets={onImportAssets}
        />
      ),
    });
    groups.push(
      {
        id: "stroke",
        title: "Stroke",
        summary: styles["border-width"] || "Width · color · style",
        content: (
          <FlatStrokeSection
            styles={styles}
            disabled={!element.capabilities.canEditStyles}
            onSetStyle={onSetStyle}
          />
        ),
      },
      {
        id: "appearance",
        title: "Appearance",
        summary: `${opacityPercent}% opacity`,
        content: (
          <FlatAppearanceSection
            styles={styles}
            gsapBorderRadius={gsapBorderRadius}
            disabled={!element.capabilities.canEditStyles}
            onSetStyle={onSetStyle}
            onPreviewStyle={previewInlineStyle}
          />
        ),
      },
      {
        id: "mask",
        title: "Post-processing",
        summary:
          inferMaskShape(styles["clip-path"] || "none") === "circle"
            ? "Mask circle"
            : "Mask rectangle",
        content: (
          <FlatMaskSection
            styles={styles}
            disabled={!element.capabilities.canEditStyles}
            onSetStyle={onSetStyle}
          />
        ),
      },
    );
  }
  if (sections.layout) {
    groups.push({
      id: "layout",
      title: "Layout",
      // No scrub accessory: FlatRow/CommitField has no pointer-drag scrubbing
      // (wheel/arrow keys only) — advertising "drag values to scrub" here lies.
      summary: `${formatPxMetricValue(displayX)},${formatPxMetricValue(displayY)} · ${Math.round(displayW)}×${Math.round(displayH)}`,
      content: (
        <FlatLayoutSection
          element={element}
          styles={styles}
          onSetStyle={onSetStyle}
          disabled={!element.capabilities.canEditStyles}
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
          currentPct={currentPct}
          seekFromKfPct={seekFromKfPct}
          animIdForProp={animIdForProp}
          resolveAnimIdForProp={animIdForProp}
          gsapRuntimeValues={gsapRuntimeValues}
          gsapKeyframes={navKeyframes}
          elStart={elStart}
          elDuration={elDuration}
          onCommitAnimatedProperty={onCommitAnimatedProperty}
          onCommitAnimatedProperties={onCommitAnimatedProperties}
          onSeekToTime={onSeekToTime}
          onRemoveKeyframe={onRemoveKeyframe}
          onConvertToKeyframes={onConvertToKeyframes}
          onLivePreviewProps={createGsapLivePreview(previewIframeRef ?? { current: null })}
          include3d={false}
        />
      ),
    });
  }
  if (showMotionEffects && gsapEffectHandlers) {
    groups.push({
      id: "animation",
      title: "Animation",
      summary: "出现 · 动作 · 消失",
      content: (
        <FlatMotionSection
          element={element}
          animations={gsapAnimations}
          showTiming={false}
          showEffects={showMotionEffects}
          currentTime={currentTime}
          multipleTimelines={gsapMultipleTimelines}
          unsupportedTimelinePattern={gsapUnsupportedTimelinePattern}
          onSetAttribute={onSetAttribute}
          onSetAttributes={onSetAttributes}
          onSeekToTime={onSeekToTime}
          {...gsapEffectHandlers}
        />
      ),
    });
  }
  if (sections.layout) {
    groups.push({
      id: "transform-3d",
      title: "3D Transform",
      summary: "9 parameters",
      content: (
        <LayoutTransform3DBlock
          gsapRuntimeValues={gsapRuntimeValues}
          gsapAnimId={gsapAnimId}
          resolveAnimIdForProp={animIdForProp}
          gsapKeyframes={navKeyframes}
          currentPct={currentPct}
          elStart={elStart}
          elDuration={elDuration}
          element={element}
          onCommitAnimatedProperties={onCommitAnimatedProperties}
          onSeekToTime={onSeekToTime}
          onRemoveKeyframe={onRemoveKeyframe}
          onConvertToKeyframes={onConvertToKeyframes}
          onLivePreviewProps={createGsapLivePreview(previewIframeRef ?? { current: null })}
        />
      ),
    });
  }
  if (sections.colorGrading) {
    groups.push({
      id: "grade",
      title: "Grade",
      accessory: <FlatColorGradingAccessory state={colorGradingController} />,
      summary: `${colorGradingController.grading.preset ?? "neutral"} · ${Math.round(colorGradingController.grading.intensity * 100)}%`,
      content: (
        <FlatColorGradingSection
          grading={colorGradingController.grading}
          assets={assets}
          onImportAssets={onImportAssets}
          onCommitColorGrading={colorGradingController.commitColorGrading}
          applyScope={colorGradingController.applyScope}
          applyBusy={colorGradingController.applyBusy}
          onSetApplyScope={colorGradingController.setApplyScope}
          onApplyToScope={() => void colorGradingController.applyToScope()}
          onApplyScopeAvailable={Boolean(onApplyColorGradingScope)}
          mediaMetadata={colorGradingController.mediaMetadata}
        />
      ),
    });
  }
  if (sections.media) {
    const mediaParameterCount = elementKind === "video" ? 10 : elementKind === "audio" ? 5 : 3;
    groups.push({
      id: "media",
      title: "Media",
      summary: `${element.tagName} · ${mediaParameterCount} parameters`,
      content: (
        <FlatMediaSection
          projectDir={projectDir}
          element={element}
          styles={styles}
          onSetStyle={onSetStyle}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={onSetHtmlAttribute}
          onRemoveBackground={onRemoveBackground}
        />
      ),
    });
  }

  // Fixed-headers + scrollable-open-section layout (design_handoff
  // scrollable-open-section, replaces the prior sticky-stacking mechanism):
  // collapsed headers before/after the open group render in normal document
  // flow and never move. Only the open group's own body content scrolls, in
  // a dedicated region between the two fixed header stacks. When no group is
  // open, every group is just a collapsed header — there's no scrollable
  // middle region at all, since nothing is expanded.
  const visibleGroups = groups.filter((group) => availableGroupIds.includes(group.id));
  visibleGroups.sort((a, b) => orderedGroupIds.indexOf(a.id) - orderedGroupIds.indexOf(b.id));
  return (
    <DesignPanelInputProvider ui="flat">
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg text-panel-text-1"
        data-preserve-studio-selection="true"
        data-testid="figma-property-inspector"
      >
        {showInspectorChrome ? (
          <DesignPanelInputProvider section="header">
            <PropertyPanelFlatHeader
              name={element.label}
              meta={`${sourceLabel} · ${element.tagName}`}
              elementKind={headerElementKind}
              onAskAgent={onAskAgent}
            />
          </DesignPanelInputProvider>
        ) : null}
        <div
          data-flat-panel-body="true"
          data-flat-inspector-surface="true"
          className="min-h-0 flex-1 overflow-y-auto bg-panel-bg"
        >
          {showInspectorChrome
            ? visibleGroups.map((group) => {
                const isOpen = group.id === openGroupId;
                return (
                  <DesignPanelInputProvider
                    key={group.id}
                    section={slugifyDesignInput(group.title)}
                  >
                    <section data-flat-group={group.id} data-flat-group-open={isOpen || undefined}>
                      <FlatGroupHeader
                        title={group.title}
                        isOpen={isOpen}
                        onToggleOpen={() => toggleOpen(group.id)}
                        accessory={isOpen ? group.accessory : undefined}
                        summary={isOpen ? undefined : group.summary}
                        animateEntrance={justToggledIds.includes(group.id)}
                      />
                      {isOpen && (
                        <div
                          data-flat-group-content="true"
                          className={`${justToggledIds.includes(group.id) ? "hf-flat-group-enter " : ""}border-b-[0.5px] border-[var(--hf-studio-divider)] bg-panel-bg px-[17px] pb-[15px] pt-2`}
                        >
                          {group.content}
                        </div>
                      )}
                    </section>
                  </DesignPanelInputProvider>
                );
              })
            : visibleGroups[0] && (
                <DesignPanelInputProvider section={slugifyDesignInput(visibleGroups[0].title)}>
                  <div data-flat-group-content="true" className="px-[17px] pb-[15px] pt-1">
                    {visibleGroups[0].content}
                  </div>
                </DesignPanelInputProvider>
              )}
        </div>
        {showInspectorChrome ? (
          <DesignPanelInputProvider section="footer">
            <PropertyPanelFlatFooter
              recordingState={recordingState}
              recordingDuration={recordingDuration}
              onToggleRecording={onToggleRecording}
            />
          </DesignPanelInputProvider>
        ) : null}
      </div>
    </DesignPanelInputProvider>
  );
}
