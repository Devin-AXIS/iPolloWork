import type { RegistryMotionPreset, RegistryMotionPresetTarget } from "@hyperframes/core/registry";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

const TEXT_TAGS = new Set(["P", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6", "LABEL", "LI"]);
const MEDIA_TAGS = new Set(["IMG", "VIDEO", "CANVAS", "PICTURE"]);
const SHAPE_TAGS = new Set(["SVG", "PATH", "RECT", "CIRCLE", "ELLIPSE", "POLYGON", "LINE"]);
const CAPTION_CONTENT_SELECTOR =
  "[data-ipw-caption-content], [data-caption-content], [data-hf-caption-content]";

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

export interface MotionPresetTimingSource {
  element?: HTMLElement | null;
  dataAttributes: Record<string, string>;
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function finiteNonNegative(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function captionOwnerFor(element: HTMLElement): HTMLElement | null {
  if (element.matches('[data-ipw-caption="true"]')) return element;
  const ancestor = element.closest<HTMLElement>('[data-ipw-caption="true"]');
  if (ancestor) return ancestor;
  const linked = element.closest<HTMLElement>("[data-ipw-caption-owner]");
  const ownerId = linked?.dataset.ipwCaptionOwner;
  return ownerId ? element.ownerDocument.getElementById(ownerId) : null;
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
  const clip = selection.element?.matches(".clip")
    ? selection.element
    : selection.element?.closest<HTMLElement>(".clip");
  const clipStart =
    finiteNonNegative(clip?.dataset.start) ??
    finiteNonNegative(selection.dataAttributes.start) ??
    0;
  const declaredClipDuration =
    finiteNonNegative(clip?.dataset.duration) ??
    finiteNonNegative(selection.dataAttributes.duration) ??
    preset.duration;
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
