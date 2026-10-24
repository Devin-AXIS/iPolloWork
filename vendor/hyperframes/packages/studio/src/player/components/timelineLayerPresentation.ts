import type { DomClipChild, TimelineElement, TimelineKind } from "../store/playerStore";
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
  hasChildren = false,
): boolean {
  if (element.timingSource !== "implicit") return true;
  if (hasChildren) return true;
  if (element.timelineKind || element.timelineRole?.trim()) return true;
  return resolveTimelineKind(element) !== "element" || hasAnimation;
}

/** Flatten only editor presentation. Source parents still own transforms and timing. */
export function presentFlatSceneLayers(
  elements: TimelineElement[], parentMap: ReadonlyMap<string, string>,
  domChildren: readonly DomClipChild[], animatedKeys: ReadonlySet<string>, scope?: TimelineElement,
): TimelineElement[] {
  const domById = new Map(domChildren.map(child => [child.id, child]));
  const parents = new Set(parentMap.values());
  const isAnimated = (element: TimelineElement) =>
    [element.key, element.id, element.domId].some(key => key !== undefined && animatedKeys.has(key));
  const visible = elements.filter(element => {
    // The scene owner is edited in overview; its contents never duplicate that row.
    if (scope && element.id === scope.id) return false;
    if (isAnimated(element) || element.compositionSrc || element.timingSource !== "implicit") return true;
    const dom = domById.get(element.id);
    if (dom?.hasVisualContent) return true;
    // Empty wrappers (including text-span wrappers) should not duplicate descendants.
    if (parents.has(element.id)) return false;
    return shouldDisplayTimelineElement(element, false);
  });
  const groups = new Map(visible.filter(element => parents.has(element.id))
    .map(element => [element.id, element]));
  return visible.map(element => {
    let parentId = parentMap.get(element.id);
    let parentLabel: string | undefined;
    const visited = new Set([element.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = groups.get(parentId);
      if (parent && parent.id !== scope?.id) {
        parentLabel = resolveTimelineLayerLabel([parent], parent.track);
        break;
      }
      parentId = parentMap.get(parentId);
    }
    return { ...element, sceneLayer: {
      role: element.id === scope?.id ? "scene" : parents.has(element.id) ? "group" : "element",
      parentLabel,
    } };
  });
}

export function resolveTimelineLayerLabel(elements: readonly TimelineElement[], track: number) {
  const first = elements[0];
  return first?.label?.trim() || first?.domId?.trim() || first?.id?.trim() || `Layer ${track + 1}`;
}

/** A shared lane's controls follow its selected clip, then the playhead. */
export function resolveTimelineLayerPrimaryElement(
  elements: readonly TimelineElement[],
  selectedElementId: string | null,
  currentTime: number,
): TimelineElement | null {
  return (
    elements.find(
      (element) =>
        selectedElementId != null &&
        [element.key, element.id, element.domId].includes(selectedElementId),
    ) ??
    elements.find(
      (element) => currentTime >= element.start && currentTime < element.start + element.duration,
    ) ??
    elements[0] ??
    null
  );
}

/** A clip caption is intentionally independent from the layer-tree label. */
export function resolveTimelineClipLabel(element: TimelineElement): string {
  return (
    element.clipLabel?.trim() ||
    element.label?.trim() ||
    element.domId?.trim() ||
    element.id.trim() ||
    element.tag
  );
}

export interface TimelineLayerSourceTarget {
  id?: string;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile: string;
}

/**
 * Resolve the authored host that owns a timeline row label. A composition row
 * is rendered from its child document, but its editable host remains in the
 * parent document. Label persistence must therefore use the manifest locator
 * and owner file instead of the inner composition root selected at runtime.
 */
export function resolveTimelineLayerSourceTarget(
  element: TimelineElement,
  fallbackSourceFile: string | null,
): TimelineLayerSourceTarget {
  return {
    id: (element.domId ?? element.id) || undefined,
    hfId: element.hfId,
    selector: element.selector,
    selectorIndex: element.selectorIndex,
    sourceFile: (element.sourceFile ?? fallbackSourceFile ?? "index.html").replace(/\\/g, "/"),
  };
}

export function resolveTimelineLayerDepth(elements: readonly TimelineElement[]) {
  const first = elements[0];
  if (first?.sceneLayer || first?.expandedParentStart === undefined) return 0;
  return Math.max(1, first.compositionAncestors?.length ?? 1);
}

export function resolveTimelineBindingId(elements: readonly TimelineElement[]): string | null {
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

/** Author-declared scenes use the total clip view, including scenes in one HTML file. */
export function resolveTimelineEditingMode(
  compositionDepth: number,
  elements: readonly Pick<TimelineElement, "compositionSrc" | "inlineScopeKind">[],
): "master" | "scene" {
  return compositionDepth > 1 || !elements.some((element) => element.compositionSrc || element.inlineScopeKind === "scene")
    ? "scene"
    : "master";
}
