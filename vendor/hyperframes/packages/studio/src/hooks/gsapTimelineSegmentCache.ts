import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { StableElementLocator } from "@hyperframes/core/motion-presets";
import type {
  KeyframeCacheEntry,
  KeyframeCacheUpdate,
} from "../player/store/playerStore";
import {
  buildTimelineAnimationSegments,
  type TimelineAnimationOwnerRange,
} from "../utils/timelineAnimationSegments";
import { buildTimelineElementKey } from "../player/lib/timelineElementHelpers";

export type TimelineSegmentsByElement = Map<
  string,
  NonNullable<KeyframeCacheEntry["animationSegments"]>
>;

interface TimelineMotionTarget {
  id: string;
  key?: string;
  domId?: string;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile?: string;
  hostId?: string;
  previewHostId?: string;
}

function resolveTimelineTargetKey(element: TimelineMotionTarget): string {
  if (element.key) return element.key;
  if (element.domId || element.selector) {
    return buildTimelineElementKey({
      id: element.id,
      fallbackIndex: 0,
      domId: element.domId,
      selector: element.selector,
      selectorIndex: element.selectorIndex,
      sourceFile: element.sourceFile,
      previewHostId: element.previewHostId ?? element.hostId,
    });
  }
  return element.id;
}

function selectorTargetsElement(
  targetSelector: string,
  element: TimelineMotionTarget,
  matchedNodes: ReadonlySet<Element>,
  matchedDomIds: ReadonlySet<string>,
  matchedHfIds: ReadonlySet<string>,
  selectorNodeCache: Map<string, Element[]>,
  doc: Document | null | undefined,
): boolean {
  if (doc) {
    if (element.domId && matchedDomIds.has(element.domId)) return true;
    if (element.hfId && matchedHfIds.has(element.hfId)) return true;
    if (element.selector) {
      try {
        let nodes = selectorNodeCache.get(element.selector);
        if (!nodes) {
          nodes = Array.from(doc.querySelectorAll(element.selector));
          selectorNodeCache.set(element.selector, nodes);
        }
        const node = nodes[element.selectorIndex ?? 0];
        if (node && matchedNodes.has(node)) return true;
      } catch {
        // Fall through to stable selector-string matching below.
      }
    }
  }

  return targetSelector.split(",").some((part) => {
    const selector = part.trim();
    if (!selector) return false;
    const lastSimple = selector.split(/\s+/).at(-1);
    return (
      (element.domId !== undefined &&
        (selector === `#${element.domId}` || lastSimple === `#${element.domId}`)) ||
      (element.selector !== undefined &&
        (selector === element.selector || lastSimple === element.selector)) ||
      (element.hfId !== undefined &&
        (selector.includes(`[data-hf-id="${element.hfId}"]`) ||
          selector.includes(`[data-hf-id='${element.hfId}']`)))
    );
  });
}

/**
 * Resolve a parsed GSAP selector to the exact identities consumed by
 * TimelineLanes. Timeline rows are not required to have a DOM id: ordinary
 * layers can be backed only by data-hf-id or a stable selector. Caching those
 * tweens only under DOM ids makes their keyframes/phase strip invisible until
 * another edit (notably clip splitting) materialises a new row identity.
 */
export function resolveGsapTimelineTargetKeys(
  targetSelector: string,
  sourceFile: string,
  elements: readonly TimelineMotionTarget[],
  doc?: Document | null,
): string[] {
  const matchedNodes = new Set<Element>();
  if (doc) {
    for (const part of targetSelector.split(",")) {
      const selector = part.trim();
      if (!selector) continue;
      try {
        for (const node of doc.querySelectorAll(selector)) matchedNodes.add(node);
      } catch {
        // The parser may preserve a runtime-only selector. Stable identity
        // matching below still handles #id/data-hf-id/exact selectors.
      }
    }
  }
  const matchedDomIds = new Set<string>();
  const matchedHfIds = new Set<string>();
  for (const node of matchedNodes) {
    if (node.id) matchedDomIds.add(node.id);
    const hfId = node.getAttribute("data-hf-id");
    if (hfId) matchedHfIds.add(hfId);
  }
  const selectorNodeCache = new Map<string, Element[]>();

  const keys = new Set<string>();
  for (const element of elements) {
    if ((element.sourceFile ?? "index.html") !== sourceFile) continue;
    if (
      selectorTargetsElement(
        targetSelector,
        element,
        matchedNodes,
        matchedDomIds,
        matchedHfIds,
        selectorNodeCache,
        doc,
      )
    ) {
      keys.add(resolveTimelineTargetKey(element));
    }
  }

  // Keep pre-iframe parsing useful for a simple id target whose timeline row
  // has not been discovered yet.
  if (keys.size === 0) {
    const id = targetSelector.match(/^#([\w-]+)$/)?.[1];
    if (id) keys.add(id);
  }
  return Array.from(keys);
}

/**
 * Semantic motion can target a leaf by stable CSS selector even when that leaf
 * has no DOM id. Resolve that locator to the exact key consumed by TimelineLanes
 * so its phase strip is attached to the same row the user selected.
 */
export function resolveMotionTimelineTargetKeys(
  target: StableElementLocator,
  sourceFile: string,
  elements: readonly TimelineMotionTarget[],
): string[] {
  const keys = new Set<string>();
  for (const element of elements) {
    if ((element.sourceFile ?? "index.html") !== sourceFile) continue;
    const matches =
      (target.elementId !== undefined &&
        (element.domId === target.elementId || element.id === target.elementId)) ||
      (target.hfId !== undefined && element.hfId === target.hfId) ||
      element.selector === target.selector;
    if (matches) keys.add(element.key ?? element.id);
  }
  return Array.from(keys);
}

export function appendTimelineAnimationSegments(
  segmentsByElement: TimelineSegmentsByElement,
  animation: GsapAnimation,
  targetIds: readonly string[],
  resolveOwnerRange: (elementId: string) => TimelineAnimationOwnerRange,
): void {
  for (const id of targetIds) {
    const segments = buildTimelineAnimationSegments([animation], resolveOwnerRange(id));
    if (segments.length === 0) continue;
    segmentsByElement.set(id, [...(segmentsByElement.get(id) ?? []), ...segments]);
  }
}

export function attachTimelineAnimationSegments(
  cacheByElement: Map<string, KeyframeCacheEntry>,
  segmentsByElement: TimelineSegmentsByElement,
): void {
  for (const [id, animationSegments] of segmentsByElement) {
    const entry = cacheByElement.get(id) ?? { format: "percentage", keyframes: [] };
    entry.animationSegments = animationSegments;
    cacheByElement.set(id, entry);
  }
}

export function buildTimelineCacheUpdates(
  sourceFile: string,
  cacheByElement: ReadonlyMap<string, KeyframeCacheEntry>,
): KeyframeCacheUpdate[] {
  return Array.from(cacheByElement).flatMap(([id, data]) => [
    { elementId: `${sourceFile}#${id}`, data },
    { elementId: id, data },
    ...(sourceFile !== "index.html" ? [{ elementId: `index.html#${id}`, data }] : []),
  ]);
}
