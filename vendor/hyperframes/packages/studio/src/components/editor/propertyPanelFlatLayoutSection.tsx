import { useEffect, useRef } from "react";
import { useStudioI18n } from "../../i18n";
import { ChevronRight, FlipHorizontal, FlipVertical, RotateCw } from "../../icons/SystemIcons";
import { FlatRow, FlatSegmentedRow, FlatSelectRow } from "./propertyPanelFlatPrimitives";
import {
  applyStudioBoxSizeDraft,
  applyStudioPathOffsetDraft,
  applyStudioRotationDraft,
} from "./manualEdits";
import { formatPxMetricValue, parsePxMetricValue } from "./propertyPanelHelpers";
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
  onLivePreviewProps?: (element: DomEditSelection, props: Record<string, number>) => void;
  large?: boolean;
}

export function flipScaleValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0 ? -value : -1;
}

export function parseCssScaleValue(value: string | undefined): { x: number; y: number } {
  const normalized = value?.trim();
  if (!normalized || normalized === "none") return { x: 1, y: 1 };
  const values = normalized
    .replaceAll(",", " ")
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .filter(Number.isFinite);
  const x = values[0] ?? 1;
  return { x, y: values[1] ?? x };
}

function readStaticScale(element: HTMLElement, authoredValue?: string): { x: number; y: number } {
  const inlineValue = element.style.getPropertyValue("scale");
  if (inlineValue) return parseCssScaleValue(inlineValue);
  if (authoredValue) return parseCssScaleValue(authoredValue);
  return parseCssScaleValue(element.ownerDocument.defaultView?.getComputedStyle(element).scale);
}

export function GeometryStepper({
  label,
  value,
  disabled = false,
  min,
  onStep,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  min?: number;
  onStep: (nextValue: number) => void;
}) {
  const { tx } = useStudioI18n();
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const step = (delta: -1 | 1) => {
    const nextValue = Math.max(min ?? Number.NEGATIVE_INFINITY, valueRef.current + delta);
    valueRef.current = nextValue;
    onStep(nextValue);
  };

  return (
    <span data-geometry-stepper="true" className="flex h-5 flex-none items-center gap-0.5">
      <button
        type="button"
        aria-label={tx(`Decrease ${label}`)}
        disabled={disabled || (min != null && valueRef.current <= min)}
        onClick={() => step(-1)}
        className="flex h-5 w-4 items-center justify-center rounded-sm text-[#858a94] transition-[color,background-color,box-shadow,transform] hover:bg-black/5 hover:text-[#24262b] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/50 disabled:cursor-default disabled:bg-panel-bg-inset disabled:text-panel-text-3 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
      >
        <ChevronRight size={10} className="rotate-180" />
      </button>
      <button
        type="button"
        aria-label={tx(`Increase ${label}`)}
        disabled={disabled}
        onClick={() => step(1)}
        className="flex h-5 w-4 items-center justify-center rounded-sm text-[#858a94] transition-[color,background-color,box-shadow,transform] hover:bg-black/5 hover:text-[#24262b] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/50 disabled:cursor-default disabled:bg-panel-bg-inset disabled:text-panel-text-3 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
      >
        <ChevronRight size={10} />
      </button>
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
  onLivePreviewProps,
  large,
}: GeometryRowsProps) {
  const valuesRef = useRef({
    x: displayX,
    y: displayY,
    width: displayW,
    height: displayH,
    rotation: displayR,
  });

  useEffect(() => {
    valuesRef.current = {
      x: displayX,
      y: displayY,
      width: displayW,
      height: displayH,
      rotation: displayR,
    };
  }, [displayH, displayR, displayW, displayX, displayY]);

  const previewGeometry = (
    property: "x" | "y" | "width" | "height" | "rotation",
    value: number,
  ) => {
    valuesRef.current = { ...valuesRef.current, [property]: value };
    if (gsapAnimId) {
      onLivePreviewProps?.(element, { [property]: value });
      return;
    }
    const values = valuesRef.current;
    if (property === "x" || property === "y") {
      applyStudioPathOffsetDraft(element.element, { x: values.x, y: values.y });
      return;
    }
    if (property === "width" || property === "height") {
      applyStudioBoxSizeDraft(element.element, {
        width: Math.max(1, values.width),
        height: Math.max(1, values.height),
      });
      return;
    }
    applyStudioRotationDraft(element.element, { angle: values.rotation });
  };

  const previewAndCommit = (
    property: "x" | "y" | "width" | "height" | "rotation",
    value: number,
    commit: (nextValue: string) => void,
  ) => {
    previewGeometry(property, value);
    commit(String(value));
  };
  const previewPxInput = (
    property: "x" | "y" | "width" | "height",
    value: string,
  ) => {
    const parsed = parsePxMetricValue(value);
    if (parsed !== null) previewGeometry(property, parsed);
  };
  const previewRotationInput = (value: string) => {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) previewGeometry("rotation", parsed);
  };
  return (
    <>
      <FlatRow
        label="X"
        value={formatPxMetricValue(displayX)}
        tier={displayX === 0 ? "default" : "explicitCustom"}
        disabled={manualOffsetEditingDisabled}
        large={large}
        onPreview={(next) => previewPxInput("x", next)}
        onCommit={(next) => {
          const parsed = parsePxMetricValue(next);
          if (parsed !== null) previewAndCommit("x", parsed, (value) => commitManualOffset("x", value));
        }}
        suffix={
          <GeometryStepper
            label="X"
            value={displayX}
            disabled={manualOffsetEditingDisabled}
            onStep={(next) =>
              previewAndCommit("x", next, (value) => commitManualOffset("x", value))
            }
          />
        }
      />
      <FlatRow
        label="Y"
        value={formatPxMetricValue(displayY)}
        tier={displayY === 0 ? "default" : "explicitCustom"}
        disabled={manualOffsetEditingDisabled}
        large={large}
        onPreview={(next) => previewPxInput("y", next)}
        onCommit={(next) => {
          const parsed = parsePxMetricValue(next);
          if (parsed !== null) previewAndCommit("y", parsed, (value) => commitManualOffset("y", value));
        }}
        suffix={
          <GeometryStepper
            label="Y"
            value={displayY}
            disabled={manualOffsetEditingDisabled}
            onStep={(next) =>
              previewAndCommit("y", next, (value) => commitManualOffset("y", value))
            }
          />
        }
      />
      {!large && (
        <>
          <FlatRow
            label="W"
            value={formatPxMetricValue(displayW)}
            tier="default"
            disabled={manualSizeEditingDisabled}
            onPreview={(next) => previewPxInput("width", next)}
            onCommit={(next) => {
              const parsed = parsePxMetricValue(next);
              if (parsed !== null && parsed > 0) {
                previewAndCommit("width", parsed, (value) => commitManualSize("width", value));
              }
            }}
            suffix={
              <GeometryStepper
                label="Width"
                value={displayW}
                min={1}
                disabled={manualSizeEditingDisabled}
                onStep={(next) =>
                  previewAndCommit("width", next, (value) => commitManualSize("width", value))
                }
              />
            }
          />
          <FlatRow
            label="H"
            value={formatPxMetricValue(displayH)}
            tier="default"
            disabled={manualSizeEditingDisabled}
            onPreview={(next) => previewPxInput("height", next)}
            onCommit={(next) => {
              const parsed = parsePxMetricValue(next);
              if (parsed !== null && parsed > 0) {
                previewAndCommit("height", parsed, (value) => commitManualSize("height", value));
              }
            }}
            suffix={
              <GeometryStepper
                label="Height"
                value={displayH}
                min={1}
                disabled={manualSizeEditingDisabled}
                onStep={(next) =>
                  previewAndCommit("height", next, (value) => commitManualSize("height", value))
                }
              />
            }
          />
        </>
      )}
      <FlatRow
        label={large ? "Rotation" : "Angle"}
        value={`${displayR}°`}
        tier="default"
        disabled={manualRotationEditingDisabled}
        large={large}
        onPreview={previewRotationInput}
        onCommit={(next) => {
          const parsed = Number.parseFloat(next);
          if (Number.isFinite(parsed)) previewAndCommit("rotation", parsed, commitManualRotation);
        }}
        suffix={
          <GeometryStepper
            label="Rotation"
            value={displayR}
            disabled={manualRotationEditingDisabled}
            onStep={(next) => previewAndCommit("rotation", next, commitManualRotation)}
          />
        }
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
  const currentScale = () =>
    props.onCommitAnimatedProperty
      ? {
          x: props.gsapRuntimeValues.scaleX ?? props.gsapRuntimeValues.scale ?? 1,
          y: props.gsapRuntimeValues.scaleY ?? props.gsapRuntimeValues.scale ?? 1,
        }
      : readStaticScale(props.element.element, props.styles.scale);
  const scaleRef = useRef(currentScale());

  useEffect(() => {
    scaleRef.current = currentScale();
  }, [
    props.element,
    props.gsapRuntimeValues.scale,
    props.gsapRuntimeValues.scaleX,
    props.gsapRuntimeValues.scaleY,
    props.onCommitAnimatedProperty,
    props.styles.scale,
  ]);

  const commitFlip = (axis: "x" | "y") => {
    const property = axis === "x" ? "scaleX" : "scaleY";
    const next = flipScaleValue(scaleRef.current[axis]);
    scaleRef.current = { ...scaleRef.current, [axis]: next };
    if (props.onCommitAnimatedProperty) {
      props.onLivePreviewProps?.(props.element, { [property]: next });
      void props.onCommitAnimatedProperty(props.element, property, next).catch(() => undefined);
      return;
    }

    // Static/template elements do not have an animation commit callback. CSS
    // `scale` keeps their authored transform intact and still updates the canvas
    // immediately before the source patch finishes.
    const cssScale = `${scaleRef.current.x} ${scaleRef.current.y}`;
    props.element.element.style.setProperty("scale", cssScale);
    void Promise.resolve(props.onSetStyle("scale", cssScale)).catch(() => undefined);
  };

  const rotateClockwise = () => {
    const next = (props.displayR + 90) % 360;
    if (props.gsapAnimId) props.onLivePreviewProps?.(props.element, { rotation: next });
    else applyStudioRotationDraft(props.element.element, { angle: next });
    props.commitManualRotation(String(next));
  };
  return (
    <div className="hf-flat-responsive-grid grid grid-cols-2 gap-2">
      <LayoutGeometryRows {...props} large />
      <div className="grid h-[34px] grid-cols-3 gap-[5px]">
        <button
          type="button"
          aria-label={tx("Rotate clockwise")}
          disabled={props.manualRotationEditingDisabled}
          onClick={rotateClockwise}
          className="flex h-[34px] items-center justify-center rounded-[6px] bg-panel-input text-[#858a94] transition-[color,background-color,box-shadow,transform] hover:bg-black/5 hover:text-[#24262b] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel-bg disabled:cursor-not-allowed disabled:bg-panel-bg-inset disabled:text-panel-text-3 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
        >
          <RotateCw size={16} />
        </button>
        <button
          type="button"
          aria-label={tx("Flip horizontally")}
          disabled={props.disabled}
          onClick={() => commitFlip("x")}
          className="flex h-[34px] items-center justify-center rounded-[6px] bg-panel-input text-[#858a94] transition-[color,background-color,box-shadow,transform] hover:bg-black/5 hover:text-[#24262b] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel-bg disabled:cursor-not-allowed disabled:bg-panel-bg-inset disabled:text-panel-text-3 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
        >
          <FlipHorizontal size={16} />
        </button>
        <button
          type="button"
          aria-label={tx("Flip vertically")}
          disabled={props.disabled}
          onClick={() => commitFlip("y")}
          className="flex h-[34px] items-center justify-center rounded-[6px] bg-panel-input text-[#858a94] transition-[color,background-color,box-shadow,transform] hover:bg-black/5 hover:text-[#24262b] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel-bg disabled:cursor-not-allowed disabled:bg-panel-bg-inset disabled:text-panel-text-3 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
        >
          <FlipVertical size={16} />
        </button>
      </div>
    </div>
  );
}
