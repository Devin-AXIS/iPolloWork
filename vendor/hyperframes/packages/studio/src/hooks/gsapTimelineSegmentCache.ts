import { isTweenConfigKey } from "@hyperframes/core/gsap-constants";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { StableElementLocator } from "@hyperframes/core/motion-presets";
import type { KeyframeCacheEntry, KeyframeCacheUpdate } from "../player/store/playerStore";
import {
  buildTimelineAnimationSegments,
  type TimelineAnimationOwnerRange,
} from "../utils/timelineAnimationSegments";
import { buildTimelineElementKey } from "../player/lib/timelineElementHelpers";
import type { TimelineElement } from "../player/store/playerStore";
import { isAnimationSharedForOwner } from "../utils/timelineAnimationSegments";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";

export type TimelineSegmentsByElement = Map<
  string,
  NonNullable<KeyframeCacheEntry["animationSegments"]>
>;

export interface TimelinePropertyRowDefinition {
  kind: "group" | "property";
  key: string;
  label: string;
  property?: string;
}

/** Standard channels offered by the property keyframe recording menu. */
export const TIMELINE_EMPTY_PROPERTY_ROWS: readonly TimelinePropertyRowDefinition[] = [
  {kind:"property",key:"x",property:"x",label:"X"},
  {kind:"property",key:"y",property:"y",label:"Y"},
  {kind:"property",key:"scale",property:"scale",label:"Scale"},
  {kind:"property",key:"rotation",property:"rotation",label:"Rotation"},
  {kind:"property",key:"opacity",property:"opacity",label:"Opacity"},
];

/** Only timed authored channels appear by default. Rows remain presentation-only. */
export function buildTimelinePropertyRows(
  animations: readonly GsapAnimation[],
  revealedProperties: readonly string[] = [],
): TimelinePropertyRowDefinition[] {
  const authored = new Set(animations.filter((animation) =>
    animation.method !== "set" && animation.duration !== 0 && resolveTweenStart(animation) !== null,
  ).flatMap((animation) => [
    ...Object.keys(animation.properties),
    ...(animation.keyframes?.keyframes.flatMap((frame) => Object.keys(frame.properties)) ?? []),
  ]).filter((property) => property !== "_auto" && property !== "id" && !isTweenConfigKey(property)));
  const properties = new Set([...authored, ...revealedProperties]);
  const labels = new Map(TIMELINE_EMPTY_PROPERTY_ROWS.map((row) => [row.key, row.label]));
  const order = ["x", "y", "xPercent", "yPercent", "translateX", "translateY", "scale", "scaleX", "scaleY", "rotation", "rotationX", "rotationY", "rotationZ", "opacity", "autoAlpha"];
  return [...order.filter((property) => properties.has(property)), ...[...properties].filter((property) => !order.includes(property))]
    .map((property) => ({kind:"property",key:property,property,label:labels.get(property) ?? property}));
}

export interface TimelinePropertyPoint {
  animation: GsapAnimation;
  percentage: number;
  time: number;
  value?: number | string;
  ease?: string;
  readOnly: boolean;
  fromFlat: boolean;
}

/** Empty channels can start animation only if no existing alias owns them. */
export function timelinePropertyHasAuthoredChannel(
  animations: readonly GsapAnimation[],
  property: string,
): boolean {
  const aliases =
    property === "x"
      ? ["x", "translateX"]
      : property === "y"
        ? ["y", "translateY"]
        : property === "rotation" || property === "rotationZ"
          ? ["rotation", "rotationZ"]
          : property.startsWith("scale")
            ? ["scale", "scaleX", "scaleY"]
            : property === "opacity" || property === "autoAlpha"
              ? ["opacity", "autoAlpha"]
              : [property];
  if (
    [
      "x",
      "y",
      "xPercent",
      "yPercent",
      "translateX",
      "translateY",
      "scale",
      "scaleX",
      "scaleY",
      "rotation",
      "rotationX",
      "rotationY",
      "rotationZ",
    ].includes(property)
  )
    aliases.push("transform");
  return animations.some((animation) =>
    aliases.some(
      (channel) =>
        channel in animation.properties ||
        channel in (animation.fromProperties ?? {}) ||
        animation.keyframes?.keyframes.some((frame) => channel in frame.properties),
    ),
  );
}

export function canStartTimelinePropertyAnimation(
  animations: readonly GsapAnimation[],
  element: TimelineElement,
  property: string,
): boolean {
  return (
    !element.timelineLocked &&
    element.duration > 0 &&
    !timelinePropertyHasAuthoredChannel(animations, property) &&
    animations.every(
      (animation) =>
        !animation.hasUnresolvedSelector &&
        !animation.hasUnresolvedKeyframes &&
        (!animation.provenance || animation.provenance.kind === "literal") &&
        !animation.arcPath?.enabled &&
        !isAnimationSharedForOwner(animation, element.domId ?? element.id, {
          hfId: element.hfId,
          selector: element.selector,
        }),
    )
  );
}

export function isTimelinePropertyAnimationEditable(
  animation: GsapAnimation,
  element: TimelineElement,
  root?: ParentNode,
): boolean {
  return (
    !element.timelineLocked &&
    !animation.hasUnresolvedKeyframes &&
    !animation.hasUnresolvedSelector &&
    !animation.durationUnresolved &&
    !animation.arcPath?.enabled &&
    (!animation.provenance || animation.provenance.kind === "literal") &&
    typeof animation.position === "number" &&
    resolveTweenDuration(animation) > 0 &&
    animation.method !== "set" &&
    (!animation.keyframes || animation.keyframes.format === "percentage") &&
    !isAnimationSharedForOwner(animation, element.domId ?? element.id, {
      hfId: element.hfId,
      root,
      selector: element.selector,
    })
  );
}

/** Each point retains source tween identity. Equal times never merge channels. */
export function buildTimelinePropertyPoints(
  animations: readonly GsapAnimation[],
  element: TimelineElement,
  property: string,
  root?: ParentNode,
): TimelinePropertyPoint[] {
  return animations
    .flatMap((animation) => {
      const start = resolveTweenStart(animation);
      if (start === null || animation.method === "set" || animation.duration === 0) return [];
      const readOnly = !isTimelinePropertyAnimationEditable(animation, element, root);
      const frames =
        animation.keyframes?.keyframes ??
        (property in animation.properties
          ? [
              {
                percentage: 0,
                properties:
                  animation.method === "fromTo"
                    ? (animation.fromProperties ?? {})
                    : animation.method === "from"
                      ? animation.properties
                      : {},
              },
              {
                percentage: 100,
                properties: animation.method === "from" ? {} : animation.properties,
              },
            ]
          : []);
      return frames
        .filter((frame) => property in frame.properties || !animation.keyframes)
        .map((frame) => ({
          animation,
          percentage: frame.percentage,
          time:
            start +
            (resolveTweenDuration(animation) * frame.percentage) / 100 +
            (element.expandedParentStart ?? 0),
          value: frame.properties[property],
          ease: "ease" in frame && typeof frame.ease === "string" ? frame.ease : undefined,
          readOnly,
          fromFlat: !animation.keyframes,
        }));
    })
    .sort((a, b) => a.time - b.time);
}

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

/** Resolve one channel without guessing between overlapping animations. Existing points are navigation-only. */
export function resolveTimelinePropertyKeyframeTarget(
  animations: readonly GsapAnimation[], element: TimelineElement, property: string,
  time: number, selectedAnimationId?: string, root?: ParentNode,
): { kind: "existing"; point: TimelinePropertyPoint } |
   { kind: "add"; animationId: string; percentage: number } |
   { kind: "blocked" } {
  if (element.timelineLocked || time < element.start || time > element.start + element.duration)
    return { kind: "blocked" };
  const points = buildTimelinePropertyPoints(animations, element, property, root);
  const atTime = points.filter(point => Math.abs(point.time - time) < 0.001);
  const existing = atTime.find(point => point.animation.id === selectedAnimationId) ??
    (atTime.length === 1 ? atTime[0] : undefined);
  if (existing) return { kind: "existing", point: existing };
  if (atTime.length > 0) return { kind: "blocked" };
  const localTime = time - (element.expandedParentStart ?? 0);
  const candidates = animations.filter(animation =>
    isTimelinePropertyAnimationEditable(animation, element, root) &&
    (property in animation.properties || animation.keyframes?.keyframes.some(frame => property in frame.properties)) &&
    localTime >= (resolveTweenStart(animation) ?? Infinity) &&
    localTime <= (resolveTweenStart(animation) ?? -Infinity) + resolveTweenDuration(animation),
  );
  const animation = candidates.find(item => item.id === selectedAnimationId) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (animation) return { kind: "add", animationId: animation.id,
    percentage: ((localTime - (resolveTweenStart(animation) ?? 0)) / resolveTweenDuration(animation)) * 100 };
  if (canStartTimelinePropertyAnimation(animations, element, property))
    return { kind: "add", animationId: "", percentage: ((time - element.start) / element.duration) * 100 };
  return { kind: "blocked" };
}
