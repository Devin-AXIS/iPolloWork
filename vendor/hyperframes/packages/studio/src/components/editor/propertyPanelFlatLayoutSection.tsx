import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";
import { FlipHorizontal, FlipVertical, RotateCw } from "../../icons/SystemIcons";
import { FlatRow, FlatSegmentedRow, FlatSelectRow } from "./propertyPanelFlatPrimitives";
import { KeyframeNavigation } from "./KeyframeNavigation";
import { formatPxMetricValue } from "./propertyPanelHelpers";
import { STUDIO_KEYFRAMES_ENABLED } from "./manualEditingAvailability";
import { resolveValueTier } from "./propertyPanelValueTier";
import { PropertyPanel3dTransform } from "./propertyPanel3dTransform";
import type { DomEditSelection } from "./domEditingTypes";

type KeyframeEntry = Array<{
  percentage: number;
  tweenPercentage?: number;
  properties: Record<string, number | string>;
  ease?: string;
}> | null;

interface GeometryRowsProps {
  element: DomEditSelection;
  displayX: number;
  displayY: number;
  displayW: number;
  displayH: number;
  displayR: number;
  manualOffsetEditingDisabled: boolean;
  manualSizeEditingDisabled: boolean;
  manualRotationEditingDisabled: boolean;
  commitManualOffset: (axis: "x" | "y", value: string) => void;
  commitManualSize: (dimension: "width" | "height", value: string) => void;
  commitManualRotation: (value: string) => void;
  gsapAnimId: string | null;
  navKeyframes: KeyframeEntry;
  currentPct: number;
  seekFromKfPct: (pct: number) => void;
  animIdForProp: (prop: string) => string;
  onCommitAnimatedProperty?: (
    element: DomEditSelection,
    property: string,
    value: number,
  ) => Promise<void>;
  onRemoveKeyframe?: (animId: string, pct: number) => void;
  onConvertToKeyframes?: (animId: string) => void;
  large?: boolean;
}

function KeyframeGutter({
  element,
  property,
  displayValue,
  gsapAnimId,
  navKeyframes,
  currentPct,
  seekFromKfPct,
  animIdForProp,
  onCommitAnimatedProperty,
  onRemoveKeyframe,
  onConvertToKeyframes,
}: {
  property: string;
  displayValue: number;
} & Pick<
  GeometryRowsProps,
  | "element"
  | "gsapAnimId"
  | "navKeyframes"
  | "currentPct"
  | "seekFromKfPct"
  | "animIdForProp"
  | "onCommitAnimatedProperty"
  | "onRemoveKeyframe"
  | "onConvertToKeyframes"
>) {
  const track = useTrackDesignInput();
  if (!STUDIO_KEYFRAMES_ENABLED || !gsapAnimId) return null;
  return (
    <span data-flat-kf-gutter="true" className="flex flex-none items-center">
      <KeyframeNavigation
        property={property}
        keyframes={navKeyframes}
        currentPercentage={currentPct}
        onSeek={seekFromKfPct}
        onAddKeyframe={() => {
          if (!onCommitAnimatedProperty) return;
          track("button", `Add ${property} keyframe`);
          void onCommitAnimatedProperty(element, property, displayValue);
        }}
        onRemoveKeyframe={(pct) => {
          if (!onRemoveKeyframe) return;
          track("button", `Remove ${property} keyframe`);
          onRemoveKeyframe(animIdForProp(property), pct);
        }}
        onConvertToKeyframes={() => {
          if (!onConvertToKeyframes) return;
          track("button", `Convert ${property} to keyframes`);
          onConvertToKeyframes(animIdForProp(property));
        }}
      />
    </span>
  );
}

export function LayoutGeometryRows({
  element,
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
  currentPct,
  seekFromKfPct,
  animIdForProp,
  onCommitAnimatedProperty,
  onRemoveKeyframe,
  onConvertToKeyframes,
  large,
}: GeometryRowsProps) {
  const gutterProps = {
    element,
    gsapAnimId,
    navKeyframes,
    currentPct,
    seekFromKfPct,
    animIdForProp,
    onCommitAnimatedProperty,
    onRemoveKeyframe,
    onConvertToKeyframes,
  };
  return (
    <>
      <FlatRow
        label="X"
        value={formatPxMetricValue(displayX)}
        tier={displayX === 0 ? "default" : "explicitCustom"}
        disabled={manualOffsetEditingDisabled}
        large={large}
        onCommit={(next) => commitManualOffset("x", next)}
        suffix={<KeyframeGutter property="x" displayValue={displayX} {...gutterProps} />}
      />
      <FlatRow
        label="Y"
        value={formatPxMetricValue(displayY)}
        tier={displayY === 0 ? "default" : "explicitCustom"}
        disabled={manualOffsetEditingDisabled}
        large={large}
        onCommit={(next) => commitManualOffset("y", next)}
        suffix={<KeyframeGutter property="y" displayValue={displayY} {...gutterProps} />}
      />
      {!large && (
        <>
          <FlatRow
            label="W"
            value={formatPxMetricValue(displayW)}
            tier="default"
            disabled={manualSizeEditingDisabled}
            onCommit={(next) => commitManualSize("width", next)}
            suffix={<KeyframeGutter property="width" displayValue={displayW} {...gutterProps} />}
          />
          <FlatRow
            label="H"
            value={formatPxMetricValue(displayH)}
            tier="default"
            disabled={manualSizeEditingDisabled}
            onCommit={(next) => commitManualSize("height", next)}
            suffix={<KeyframeGutter property="height" displayValue={displayH} {...gutterProps} />}
          />
        </>
      )}
      <FlatRow
        label={large ? "Rotation" : "Angle"}
        value={`${displayR}°`}
        tier="default"
        disabled={manualRotationEditingDisabled}
        large={large}
        onCommit={(next) => commitManualRotation(next.replace("°", ""))}
        suffix={<KeyframeGutter property="rotation" displayValue={displayR} {...gutterProps} />}
      />
    </>
  );
}

export function LayoutZIndexRow({
  styles,
  onSetStyle,
}: {
  styles: Record<string, string>;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
}) {
  const zIndex = String(parseInt(styles["z-index"] || "auto", 10) || 0);
  return (
    <FlatRow
      label="Z-index"
      value={zIndex}
      tier="default"
      onCommit={(next) => void onSetStyle("z-index", next)}
    />
  );
}

export function LayoutFlexBlock({
  styles,
  onSetStyle,
  disabled,
}: {
  styles: Record<string, string>;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  disabled: boolean;
}) {
  const { tx } = useStudioI18n();
  const isFlex = styles.display === "flex" || styles.display === "inline-flex";
  if (!isFlex) return null;
  const direction = styles["flex-direction"] || "row";
  return (
    <div className="border-l-2 border-panel-border-input py-0.5 pl-[10px]">
      <div className="mb-[3px] text-[9px] font-semibold uppercase tracking-[0.12em] text-panel-text-5">
        {tx("Flex")}
      </div>
      <FlatSegmentedRow
        label="Direction"
        options={[
          { key: "row", node: tx("→ Row"), label: "Row", active: direction === "row" },
          { key: "column", node: tx("Column"), label: "Column", active: direction === "column" },
        ]}
        disabled={disabled}
        onChange={(next) => void onSetStyle("flex-direction", next)}
      />
      <FlatSelectRow
        label="Justify"
        value={styles["justify-content"] || "flex-start"}
        tier={resolveValueTier(styles["justify-content"], "flex-start")}
        disabled={disabled}
        options={[
          "flex-start",
          "center",
          "space-between",
          "space-around",
          "space-evenly",
          "flex-end",
        ]}
        onChange={(next) => void onSetStyle("justify-content", next)}
      />
      <FlatSelectRow
        label="Align"
        value={styles["align-items"] || "stretch"}
        tier={resolveValueTier(styles["align-items"], "stretch")}
        disabled={disabled}
        options={["stretch", "flex-start", "center", "flex-end", "baseline"]}
        onChange={(next) => void onSetStyle("align-items", next)}
      />
      <FlatRow
        label="Gap"
        value={styles.gap ?? "0px"}
        tier={resolveValueTier(styles.gap, "0px")}
        disabled={disabled}
        onCommit={(next) => void onSetStyle("gap", next.endsWith("px") ? next : `${next}px`)}
      />
    </div>
  );
}

export function LayoutTransform3DBlock({
  gsapRuntimeValues,
  gsapAnimId,
  resolveAnimIdForProp,
  gsapKeyframes,
  currentPct,
  elStart,
  elDuration,
  element,
  onCommitAnimatedProperty,
  onCommitAnimatedProperties,
  onSeekToTime,
  onRemoveKeyframe,
  onConvertToKeyframes,
  onLivePreviewProps,
}: {
  gsapRuntimeValues: Record<string, number>;
  gsapAnimId: string | null;
  resolveAnimIdForProp?: (prop: string) => string | null;
  gsapKeyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }> | null;
  currentPct: number;
  elStart: number;
  elDuration: number;
  element: DomEditSelection;
  onCommitAnimatedProperty?: (
    element: DomEditSelection,
    property: string,
    value: number,
  ) => Promise<void>;
  onCommitAnimatedProperties?: (
    element: DomEditSelection,
    props: Record<string, number | string>,
  ) => Promise<void>;
  onSeekToTime?: (time: number) => void;
  onRemoveKeyframe?: (animId: string, pct: number) => void;
  onConvertToKeyframes?: (animId: string, duration?: number) => void;
  onLivePreviewProps?: (element: DomEditSelection, props: Record<string, number>) => void;
}) {
  return (
    <div>
      <PropertyPanel3dTransform
        gsapRuntimeValues={gsapRuntimeValues}
        gsapAnimId={gsapAnimId}
        resolveAnimIdForProp={resolveAnimIdForProp}
        gsapKeyframes={gsapKeyframes}
        currentPct={currentPct}
        elStart={elStart}
        elDuration={elDuration}
        element={element}
        onCommitAnimatedProperty={onCommitAnimatedProperty}
        onCommitAnimatedProperties={onCommitAnimatedProperties}
        onSeekToTime={onSeekToTime}
        onRemoveKeyframe={onRemoveKeyframe}
        onConvertToKeyframes={onConvertToKeyframes}
        onLivePreviewProps={onLivePreviewProps}
      />
    </div>
  );
}

interface FlatLayoutSectionProps
  extends
    Omit<GeometryRowsProps, never>,
    Pick<
      Parameters<typeof LayoutTransform3DBlock>[0],
      | "gsapRuntimeValues"
      | "resolveAnimIdForProp"
      | "gsapKeyframes"
      | "elStart"
      | "elDuration"
      | "onCommitAnimatedProperties"
      | "onSeekToTime"
      | "onLivePreviewProps"
    > {
  element: DomEditSelection;
  styles: Record<string, string>;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  disabled: boolean;
  include3d?: boolean;
}

export function FlatLayoutSection(props: FlatLayoutSectionProps) {
  const { tx } = useStudioI18n();
  return (
    <div className="hf-flat-responsive-grid grid grid-cols-2 gap-2">
      <LayoutGeometryRows {...props} large />
      <div className="grid h-[34px] grid-cols-3 gap-[5px]">
        <button
          type="button"
          aria-label={tx("Rotate clockwise")}
          disabled={props.manualRotationEditingDisabled}
          onClick={() => props.commitManualRotation(String((props.displayR + 90) % 360))}
          className="flex h-[34px] items-center justify-center rounded-[6px] bg-panel-input text-[#858a94] transition-colors hover:text-[#24262b] disabled:cursor-not-allowed"
        >
          <RotateCw size={16} />
        </button>
        <button
          type="button"
          aria-label={tx("Flip horizontally (unavailable)")}
          disabled
          className="flex h-[34px] items-center justify-center rounded-[6px] bg-panel-input text-[#858a94] disabled:cursor-not-allowed"
        >
          <FlipHorizontal size={16} />
        </button>
        <button
          type="button"
          aria-label={tx("Flip vertically (unavailable)")}
          disabled
          className="flex h-[34px] items-center justify-center rounded-[6px] bg-panel-input text-[#858a94] disabled:cursor-not-allowed"
        >
          <FlipVertical size={16} />
        </button>
      </div>
    </div>
  );
}
