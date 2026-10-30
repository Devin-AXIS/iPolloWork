import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./domEditingTypes";
import { readStudioBoxSize, readStudioPathOffset } from "./manualEdits";
import { parsePxMetricValue, type PropertyPanelProps } from "./propertyPanelHelpers";

interface TransformCommitDeps {
  element: DomEditSelection;
  styles: Record<string, string>;
  hasGsapAnimation: boolean;
  layoutPosition: { x: number; y: number };
  gsapAnimId: string | null;
  gsapKeyframes: unknown;
  currentPct: number;
  onCommitAnimatedProperty: PropertyPanelProps["onCommitAnimatedProperty"];
  onAddKeyframe: PropertyPanelProps["onAddKeyframe"];
  onSetManualOffset: PropertyPanelProps["onSetManualOffset"];
  onSetManualSize: PropertyPanelProps["onSetManualSize"];
  onSetManualRotation: PropertyPanelProps["onSetManualRotation"];
  showToast?: (message: string, tone?: "error" | "info") => void;
}

/**
 * Build the X/Y, W/H and rotation field commit handlers for the property panel.
 * Layout X/Y always offset the entire authored path, regardless of selected
 * keyframes. Size and rotation retain their existing commit behavior.
 */
// fallow-ignore-next-line unit-size
export function createTransformCommitHandlers({
  element,
  styles,
  hasGsapAnimation,
  layoutPosition,
  gsapAnimId,
  gsapKeyframes,
  currentPct,
  onCommitAnimatedProperty,
  onAddKeyframe,
  onSetManualOffset,
  onSetManualSize,
  onSetManualRotation,
  showToast,
}: TransformCommitDeps) {
  // Route a transform value into the GSAP animation (or a new keyframe) when the
  // element is animated. Returns true when handled, so callers fall through to
  // the manual-transform path only for non-animated elements.
  const commitAnimatedTransformValue = (
    property: string,
    value: number,
    noCallbacksMessage: string,
  ): boolean => {
    if (onCommitAnimatedProperty && hasGsapAnimation) {
      void onCommitAnimatedProperty(element, property, value);
      return true;
    }
    if (gsapKeyframes && gsapAnimId && onAddKeyframe) {
      const pct = Math.max(0, Math.min(100, Math.round(currentPct * 10) / 10));
      onAddKeyframe(gsapAnimId, pct, property, value);
      return true;
    }
    if (hasGsapAnimation) {
      showToast?.(noCallbacksMessage);
      return true;
    }
    return false;
  };

  const commitManualOffset = (axis: "x" | "y", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null) return;
    if (hasGsapAnimation) {
      if (onCommitAnimatedProperty) {
        void onCommitAnimatedProperty(element, axis, parsed, {
          positionDelta: parsed - layoutPosition[axis],
        });
      } else {
        showToast?.("Cannot edit position — animation callbacks not available");
      }
      return;
    }
    const current = readStudioPathOffset(element.element);
    void Promise.resolve(
      onSetManualOffset(element, {
        x: axis === "x" ? parsed : current.x,
        y: axis === "y" ? parsed : current.y,
      }),
    ).catch(() => undefined);
  };

  // fallow-ignore-next-line complexity
  const commitManualSize = (axis: "width" | "height", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    if (onCommitAnimatedProperty && hasGsapAnimation) {
      void onCommitAnimatedProperty(element, axis, parsed);
      return;
    }
    if (hasGsapAnimation) {
      showToast?.("Cannot edit size — animation callbacks not available");
      return;
    }
    const current = readStudioBoxSize(element.element);
    const width =
      current.width > 0
        ? current.width
        : (parsePxMetricValue(styles.width ?? "") ?? element.boundingBox.width);
    const height =
      current.height > 0
        ? current.height
        : (parsePxMetricValue(styles.height ?? "") ?? element.boundingBox.height);
    void Promise.resolve(
      onSetManualSize(element, {
        width: axis === "width" ? parsed : width,
        height: axis === "height" ? parsed : height,
      }),
    ).catch(() => undefined);
  };

  const commitManualRotation = (nextValue: string) => {
    const parsed = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsed)) return;
    if (
      commitAnimatedTransformValue(
        "rotation",
        parsed,
        "Cannot edit rotation — animation callbacks not available",
      )
    )
      return;
    void Promise.resolve(onSetManualRotation(element, { angle: parsed })).catch(() => undefined);
  };

  return { commitManualOffset, commitManualSize, commitManualRotation };
}

/** Layout position is the static GSAP base, not the playhead's interpolated pose. */
export function readLayoutPosition(
  animations: GsapAnimation[],
  manualOffset: { x: number; y: number },
): { x: number; y: number } {
  const position = { ...manualOffset };
  for (const animation of animations) {
    if (animation.method !== "set" || !animation.global) continue;
    const x = animation.properties.x ?? animation.properties.translateX;
    const y = animation.properties.y ?? animation.properties.translateY;
    if (typeof x === "number") position.x = x;
    if (typeof y === "number") position.y = y;
  }
  return position;
}
