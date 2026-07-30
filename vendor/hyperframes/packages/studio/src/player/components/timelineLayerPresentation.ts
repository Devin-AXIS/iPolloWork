import type { TimelineElement, TimelineKind } from "../store/playerStore";
import { isAudioTimelineElement, isMusicTrack } from "../../utils/timelineInspector";

const TEXT_TAGS = new Set([
  "blockquote",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "p",
  "small",
  "span",
  "strong",
]);

const LEGACY_LOGO_NAME = /(^|[-_\s])(brand-?)?logo($|[-_\s])/i;
export const TIMELINE_COLOR_COUNT = 12;

function hashTimelineIdentity(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveTimelineKind(element: TimelineElement): TimelineKind {
  if (element.timelineKind) return element.timelineKind;
  if (element.compositionSrc) return "composition";
  if (isMusicTrack(element)) return "music";
  if (isAudioTimelineElement(element)) {
    if (element.timelineRole === "voiceover" || element.timelineRole === "narration") {
      return "voiceover";
    }
    return "audio";
  }

  const tag = element.tag.trim().toLowerCase();
  if (tag === "video") return "video";
  if (tag === "img") {
    const identity = `${element.label ?? ""} ${element.domId ?? element.id}`;
    return LEGACY_LOGO_NAME.test(identity) ? "logo" : "image";
  }
  if (TEXT_TAGS.has(tag)) return "text";
  if (element.timelineRole === "effect" || element.timelineRole === "overlay") return "effect";
  return "element";
}

/**
 * Implicit generic DOM wrappers are implementation structure, not editable
 * media. Keep authored clips and meaningful media kinds, and surface an
 * implicit generic element only when it owns real animation data.
 */
export function shouldDisplayTimelineElement(
  element: TimelineElement,
  hasAnimation: boolean,
): boolean {
  if (element.timingSource !== "implicit") return true;
  if (element.timelineKind || element.timelineRole?.trim()) return true;
  return resolveTimelineKind(element) !== "element" || hasAnimation;
}

export function resolveTimelineLayerLabel(elements: readonly TimelineElement[], track: number) {
  const first = elements[0];
  return first?.label?.trim() || first?.domId?.trim() || first?.id?.trim() || `Layer ${track + 1}`;
}

export function resolveTimelineLayerDepth(elements: readonly TimelineElement[]) {
  const first = elements[0];
  if (first?.expandedParentStart === undefined) return 0;
  return Math.max(1, first.compositionAncestors?.length ?? 1);
}

export function resolveTimelineBindingId(
  elements: readonly TimelineElement[],
): string | null {
  for (const element of elements) {
    const bindingId = element.timelineGroupId?.trim();
    if (bindingId) return bindingId;
  }
  return null;
}

export function resolveTimelineColorGroupKey(element: TimelineElement): string {
  const authoredGroup = element.timelineGroupId?.trim();
  if (authoredGroup) return `group:${authoredGroup}`;

  const identity =
    element.key ??
    element.hfId ??
    `${element.sourceFile ?? "timeline"}:${element.domId ?? element.id}`;
  return `element:${identity}`;
}

/**
 * Assign stable palette slots per visible binding group. Hashing keeps colors
 * stable, while linear probing prevents independent visible items from sharing
 * a slot until the finite palette is exhausted.
 */
export function buildTimelineColorIndexes(
  elements: readonly TimelineElement[],
): Map<string, number> {
  const indexes = new Map<string, number>();
  const used = new Set<number>();

  for (const element of elements) {
    const groupKey = resolveTimelineColorGroupKey(element);
    if (indexes.has(groupKey)) continue;

    let index = hashTimelineIdentity(groupKey) % TIMELINE_COLOR_COUNT;
    if (used.size < TIMELINE_COLOR_COUNT) {
      while (used.has(index)) index = (index + 1) % TIMELINE_COLOR_COUNT;
    }
    indexes.set(groupKey, index);
    used.add(index);
  }

  return indexes;
}
