import type { RegistryMotionPreset, RegistryMotionPresetTarget } from "@hyperframes/core/registry";
import type { MotionPhase } from "@hyperframes/core/motion-presets";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

const TEXT_TAGS = new Set(["P", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6", "LABEL", "LI"]);
const MEDIA_TAGS = new Set(["IMG", "VIDEO", "CANVAS", "PICTURE"]);
const SHAPE_TAGS = new Set(["SVG", "PATH", "RECT", "CIRCLE", "ELLIPSE", "POLYGON", "LINE"]);
const CAPTION_CONTENT_SELECTOR =
  '[data-ipw-caption-text="true"], [data-ipw-caption-content], [data-caption-content], [data-hf-caption-content]';

export interface MotionPresetSelection {
  compatible: boolean;
  kinds: RegistryMotionPresetTarget[];
  targetElement: HTMLElement | null;
  reason: string | null;
}

export interface MotionPresetTiming {
  position: number;
  duration: number;
}

export interface MotionTimelineSpan {
  start: number;
  end: number;
  duration: number;
  constrained: boolean;
}

export interface MotionPresetTimingSource {
  element?: HTMLElement | null;
  dataAttributes: Record<string, string>;
}

/**
 * Registry motion coordinates are authored as offsets around the element's
 * current layout position. Persist them as absolute GSAP coordinates so adding
 * a preset never teleports an element that the user already placed.
 */
export function rebaseMotionPresetKeyframes(
  keyframes: RegistryMotionPreset["keyframes"],
  base: { x: number; y: number },
): RegistryMotionPreset["keyframes"] {
  return keyframes.map((keyframe) => {
    const properties = { ...keyframe.properties };
    for (const property of ["x", "translateX"] as const) {
      if (typeof properties[property] === "number") {
        properties[property] = roundTo3(properties[property] + base.x);
      }
    }
    for (const property of ["y", "translateY"] as const) {
      if (typeof properties[property] === "number") {
        properties[property] = roundTo3(properties[property] + base.y);
      }
    }
    return { ...keyframe, properties };
  });
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function finiteNonNegative(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositive(value: string | undefined): number | null {
  const parsed = finiteNonNegative(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function timingOwnerFor(element: HTMLElement | null | undefined): HTMLElement | null {
  return (
    element?.closest<HTMLElement>(
      ".clip, [data-start][data-duration], [data-composition-id][data-duration]",
    ) ?? null
  );
}

export function resolveMotionTimelineSpan(
  selection: MotionPresetTimingSource,
  fallbackDuration: number,
): MotionTimelineSpan {
  const owner = timingOwnerFor(selection.element);
  const ownerStart = finiteNonNegative(owner?.dataset.start);
  const ownerDuration = finitePositive(owner?.dataset.duration);
  const selectionStart = finiteNonNegative(selection.dataAttributes.start);
  const selectionDuration = finitePositive(selection.dataAttributes.duration);
  const start = ownerStart ?? selectionStart ?? 0;
  const duration = ownerDuration ?? selectionDuration ?? fallbackDuration;
  return {
    start,
    end: roundTo3(start + duration),
    duration,
    constrained: ownerDuration !== null || selectionDuration !== null,
  };
}

function captionOwnerFor(element: HTMLElement): HTMLElement | null {
  if (element.matches('[data-ipw-caption="true"]')) return element;
  const ancestor = element.closest<HTMLElement>('[data-ipw-caption="true"]');
  if (ancestor) return ancestor;
  const linked = element.closest<HTMLElement>("[data-ipw-caption-owner]");
  const ownerId = linked?.dataset.ipwCaptionOwner;
  return ownerId ? element.ownerDocument.getElementById(ownerId) : null;
}

export function isCaptionMotionTarget(element: HTMLElement | null | undefined): boolean {
  return Boolean(element && captionOwnerFor(element));
}

function captionContentFor(element: HTMLElement, captionOwner: HTMLElement): HTMLElement | null {
  if (element.matches(CAPTION_CONTENT_SELECTOR)) return element;
  const selectedContent = element.closest<HTMLElement>(CAPTION_CONTENT_SELECTOR);
  if (selectedContent) return selectedContent;
  const nestedContent = captionOwner.querySelector<HTMLElement>(CAPTION_CONTENT_SELECTOR);
  if (nestedContent) return nestedContent;
  if (!captionOwner.id) return null;
  for (const linked of captionOwner.ownerDocument.querySelectorAll<HTMLElement>(
    "[data-ipw-caption-owner]",
  )) {
    if (linked.dataset.ipwCaptionOwner !== captionOwner.id) continue;
    if (linked.matches(CAPTION_CONTENT_SELECTOR)) return linked;
    const linkedContent = linked.querySelector<HTMLElement>(CAPTION_CONTENT_SELECTOR);
    if (linkedContent) return linkedContent;
  }
  return null;
}

/** Resolve a generated caption wrapper to its authored text node. */
export function resolveCaptionMotionTargetElement(element: HTMLElement): HTMLElement {
  const owner = captionOwnerFor(element);
  return owner ? (captionContentFor(element, owner) ?? element) : element;
}

function targetKinds(
  element: HTMLElement,
  captionOwner: HTMLElement | null,
): RegistryMotionPresetTarget[] {
  if (captionOwner) return ["caption", "text", "any"];
  if (element.hasAttribute("data-hf-group")) return ["group", "any"];
  if (MEDIA_TAGS.has(element.tagName)) return ["image", "any"];
  if (SHAPE_TAGS.has(element.tagName)) return ["shape", "any"];
  if (TEXT_TAGS.has(element.tagName) || Boolean(element.textContent?.trim()))
    return ["text", "any"];
  return ["any"];
}

export function resolveMotionPresetSelection(
  selection: DomEditSelection | null,
  preset: RegistryMotionPreset,
): MotionPresetSelection {
  if (!selection) {
    return {
      compatible: false,
      kinds: [],
      targetElement: null,
      reason: "Select an element in the preview first",
    };
  }

  const captionOwner = captionOwnerFor(selection.element);
  const kinds = targetKinds(selection.element, captionOwner);
  const compatible = preset.targets.some((target) => kinds.includes(target));
  if (!compatible) {
    return {
      compatible: false,
      kinds,
      targetElement: null,
      reason: `This preset supports ${preset.targets.join(", ")}`,
    };
  }

  if (captionOwner) {
    const captionContent = captionContentFor(selection.element, captionOwner);
    if (!captionContent) {
      return {
        compatible: false,
        kinds,
        targetElement: null,
        reason: "This caption needs an inner content wrapper before animation",
      };
    }
    return { compatible: true, kinds, targetElement: captionContent, reason: null };
  }

  return { compatible: true, kinds, targetElement: selection.element, reason: null };
}

export function resolveMotionPresetTiming(
  selection: MotionPresetTimingSource,
  preset: RegistryMotionPreset,
  currentTime: number,
): MotionPresetTiming {
  const span = resolveMotionTimelineSpan(selection, preset.duration);
  const clipStart = span.start;
  const declaredClipDuration = span.duration;
  const clipDuration = Math.max(0.1, declaredClipDuration);
  const duration = Math.min(preset.duration, clipDuration);
  const latestStart = clipStart + clipDuration - duration;

  if (preset.anchor === "clip-start") {
    return { position: roundTo3(clipStart), duration: roundTo3(duration) };
  }
  if (preset.anchor === "clip-end") {
    return { position: roundTo3(latestStart), duration: roundTo3(duration) };
  }
  const playheadPosition = Math.max(clipStart, Math.min(currentTime, latestStart));
  return { position: roundTo3(playheadPosition), duration: roundTo3(duration) };
}

export function resolveSemanticMotionTiming(
  selection: MotionPresetTimingSource,
  phase: MotionPhase,
  requestedDuration: number,
  requestedPosition?: number,
): MotionPresetTiming {
  const span = resolveMotionTimelineSpan(selection, requestedDuration);
  const clipDuration = Math.max(0.1, span.duration);
  const duration = span.constrained
    ? Math.min(Math.max(0.1, requestedDuration), clipDuration)
    : Math.max(0.1, requestedDuration);
  const latestStart = span.start + clipDuration - duration;
  const defaultPosition =
    phase === "enter" ? span.start : phase === "exit" ? latestStart : span.start;
  const position =
    requestedPosition !== undefined &&
    Number.isFinite(requestedPosition) &&
    (!span.constrained || (requestedPosition >= span.start && requestedPosition <= latestStart))
      ? requestedPosition
      : defaultPosition;
  return { position: roundTo3(position), duration: roundTo3(duration) };
}

export function resolveStructuredTextMotionTiming(
  selection: MotionPresetTimingSource,
  phase: MotionPhase,
  requestedDuration: number,
  requestedPosition?: number,
): MotionPresetTiming {
  if (!isCaptionMotionTarget(selection.element) || phase === "exit") {
    return resolveSemanticMotionTiming(selection, phase, requestedDuration, requestedPosition);
  }

  const span = resolveMotionTimelineSpan(selection, requestedDuration);
  return resolveSemanticMotionTiming(selection, phase, requestedDuration, span.start);
}
