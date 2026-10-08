import type { RuntimeTimelineLike } from "./types";
import { swallow } from "./diagnostics";
import { readElementPlaybackRate } from "./media";
import { parseNumeric, parseStartExpression } from "./startExpression";

const AUTHORED_DURATION_ATTR = "data-hf-authored-duration";
const AUTHORED_END_ATTR = "data-hf-authored-end";

function parseDurationAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute("data-duration"));
}

function parseEndAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute("data-end"));
}

function parseAuthoredDurationAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute(AUTHORED_DURATION_ATTR));
}

function parseAuthoredEndAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute(AUTHORED_END_ATTR));
}

/** Prefer instance mounts over an authored id retained by a sibling inner root. */
export function resolveCompositionElement(compositionId: string): Element | null {
  const matches = Array.from(document.querySelectorAll(`[data-composition-id="${CSS.escape(compositionId)}"]`));
  return matches.find(node => !node.hasAttribute("data-hf-inner-root") &&
    (node.hasAttribute("data-composition-file") || node.hasAttribute("data-composition-src"))) ??
    matches.find(node => !node.hasAttribute("data-hf-inner-root")) ?? matches[0] ?? null;
}

/** Composition slots use the parent's clock; their contents use the source clock. */
export function readCompositionPlaybackRate(element: Element): number {
  if (
    !element.hasAttribute("data-composition-id") &&
    !element.hasAttribute("data-composition-src") &&
    !element.hasAttribute("data-composition-file")
  )
    return 1;
  const rate = parseNumeric(element.getAttribute("data-playback-rate"));
  return rate != null && rate > 0 ? rate : 1;
}

export function readCompositionPlaybackStart(element: Element): number {
  return element.hasAttribute("data-source-duration")
    ? Math.max(0, parseNumeric(element.getAttribute("data-playback-start")) ?? 0)
    : 0;
}

export function hasCompositionRetime(element: Element): boolean {
  let node: Element | null = element;
  while (node) {
    if (
      node.hasAttribute("data-source-duration") &&
      readCompositionPlaybackRate(node) > 0 &&
      (node.hasAttribute("data-composition-id") ||
        node.hasAttribute("data-composition-src") ||
        node.hasAttribute("data-composition-file"))
    )
      return true;
    node = parentComposition(node);
  }
  return false;
}

function parentComposition(element: Element): Element | null {
  return element.parentElement?.closest("[data-composition-id]:not([data-hf-inner-root])") ?? null;
}

export function resolveAncestorCompositionPlaybackRate(element: Element): number {
  let rate = 1;
  let host = parentComposition(element);
  while (host) {
    rate *= readCompositionPlaybackRate(host);
    host = parentComposition(host);
  }
  return rate;
}

export function resolveCompositionSourceTime(
  element: Element,
  time: number,
  start: number,
): number {
  const rate =
    readCompositionPlaybackRate(element) * resolveAncestorCompositionPlaybackRate(element);
  const offset = readCompositionPlaybackStart(element);
  const sourceDuration = parseNumeric(element.getAttribute("data-source-duration"));
  const localTime = Math.max(0, offset + (time - start) * rate);
  return sourceDuration != null && sourceDuration > 0
    ? Math.min(sourceDuration, localTime)
    : localTime;
}

/** Reuse GSAP nesting for playback, paused seeking and deterministic export. */
export function retimeCompositionTimeline(params: {
  element: Element;
  timeline: RuntimeTimelineLike;
  parent: RuntimeTimelineLike;
  timelineRegistry: Record<string, RuntimeTimelineLike | undefined>;
  resolver: ReturnType<typeof createRuntimeStartTimeResolver>;
}): number {
  const { element, timeline, parent, timelineRegistry, resolver } = params;
  const rate =
    readCompositionPlaybackRate(element) * resolveAncestorCompositionPlaybackRate(element);
  const trim = readCompositionPlaybackStart(element);
  const start = resolver.resolveStartForElement(element, 0);
  let parentRate = 1;
  let parentStart = 0;
  let parentTrim = 0;
  for (const node of document.querySelectorAll("[data-composition-id]")) {
    if (timelineRegistry[node.getAttribute("data-composition-id")!] !== parent) continue;
    parentRate = readCompositionPlaybackRate(node) * resolveAncestorCompositionPlaybackRate(node);
    parentStart = resolver.resolveStartForElement(node, 0);
    parentTrim = readCompositionPlaybackStart(node);
    break;
  }
  if (hasCompositionRetime(element)) {
    timeline.timeScale?.(rate / parentRate);
  }
  return parentTrim + (start - trim / rate - parentStart) * parentRate;
}

export function createRuntimeStartTimeResolver(params: {
  timelineRegistry?: Record<string, RuntimeTimelineLike | undefined>;
  includeAuthoredTimingAttrs?: boolean;
}): {
  resolveStartForElement: (element: Element, fallback?: number) => number;
  resolveDurationForElement: (element: Element) => number | null;
} {
  const timelineRegistry = params.timelineRegistry ?? {};
  const includeAuthoredTimingAttrs = params.includeAuthoredTimingAttrs ?? false;
  const startCache = new WeakMap<Element, number | null>();
  const durationCache = new WeakMap<Element, number | null>();
  const visiting = new Set<Element>();

  const findReferenceTarget = (refId: string): Element | null => {
    const byId = document.getElementById(refId);
    if (byId) return byId;
    return resolveCompositionElement(refId);
  };

  const resolveDurationForElement = (element: Element): number | null => {
    const cached = durationCache.get(element);
    if (cached !== undefined) return cached;
    let resolved: number | null = null;
    const durationAttr =
      parseDurationAttr(element) ??
      (includeAuthoredTimingAttrs ? parseAuthoredDurationAttr(element) : null);
    if (durationAttr != null && durationAttr > 0) {
      resolved = durationAttr / resolveAncestorCompositionPlaybackRate(element);
    }
    if (resolved == null || resolved <= 0) {
      const endAttr =
        parseEndAttr(element) ??
        (includeAuthoredTimingAttrs ? parseAuthoredEndAttr(element) : null);
      if (endAttr != null) {
        const start = resolveStartForElementInternal(element, 0);
        const host = parentComposition(element);
        const hostStart = host ? resolveStartForElementInternal(host, 0) : 0;
        const trim = host ? readCompositionPlaybackStart(host) : 0;
        const delta = hasCompositionRetime(element)
          ? hostStart + (endAttr - trim) / resolveAncestorCompositionPlaybackRate(element) - start
          : endAttr - start;
        if (Number.isFinite(delta) && delta > 0) {
          resolved = delta;
        }
      }
    }
    if ((resolved == null || resolved <= 0) && element instanceof HTMLMediaElement) {
      const playbackStart =
        parseNumeric(element.getAttribute("data-playback-start")) ??
        parseNumeric(element.getAttribute("data-media-start")) ??
        0;
      if (Number.isFinite(element.duration) && element.duration > playbackStart) {
        resolved =
          (element.duration - playbackStart) /
          (readElementPlaybackRate(element) * resolveAncestorCompositionPlaybackRate(element));
      }
    }
    if (resolved == null || resolved <= 0) {
      const compositionId = element.getAttribute("data-composition-id");
      if (compositionId) {
        const timeline = timelineRegistry[compositionId] ?? null;
        if (timeline && typeof timeline.duration === "function") {
          try {
            const timelineDuration = Number(timeline.duration());
            if (Number.isFinite(timelineDuration) && timelineDuration > 0) {
              resolved =
                timelineDuration /
                (readCompositionPlaybackRate(element) *
                  resolveAncestorCompositionPlaybackRate(element));
            }
          } catch (err) {
            // ignore broken timeline impls
            swallow("runtime.startResolver.site1", err);
          }
        }
      }
    }
    if (resolved != null && Number.isFinite(resolved) && resolved > 0) {
      durationCache.set(element, resolved);
      return resolved;
    }
    durationCache.set(element, null);
    return null;
  };

  const resolveHostOffsetForElement = (element: Element, fallback: number): number => {
    if (element.hasAttribute("data-composition-id")) {
      const parentComposition = element.parentElement?.closest("[data-composition-id]:not([data-hf-inner-root])");
      if (!parentComposition) return 0;
      return resolveStartForElementInternal(parentComposition, fallback);
    }
    const compositionRoot = element.closest("[data-composition-id]");
    if (!compositionRoot) return 0;
    return resolveStartForElementInternal(compositionRoot, fallback);
  };

  const resolveStartForElementInternal = (element: Element, fallback: number): number => {
    const cached = startCache.get(element);
    if (cached !== undefined) {
      return cached == null ? fallback : cached;
    }
    if (visiting.has(element)) {
      return fallback;
    }
    visiting.add(element);
    try {
      const expression = parseStartExpression(element.getAttribute("data-start"));
      if (!expression) {
        // If this element is a loaded composition inner root (has data-composition-id
        // but no data-start), walk up to the host parent which carries the actual
        // timing. This happens when the host uses a different data-composition-id
        // than the loaded file — e.g. host="montage" but file has "scene-10", or
        // when the host itself has no data-composition-id at all (an "anonymous"
        // host) and the composition's own id was restored onto the inlined wrapper.
        // Check data-composition-src (runtime, not yet inlined), data-composition-id
        // (bundled/compiled host with its own id), and data-composition-file (the
        // marker every inlined host gets, compiled or bundled, once
        // data-composition-src is stripped — covers the anonymous-host case).
        if (element.hasAttribute("data-composition-id")) {
          const parent = element.parentElement;
          if (
            parent &&
            (parent.hasAttribute("data-composition-src") ||
              parent.hasAttribute("data-composition-id") ||
              parent.hasAttribute("data-composition-file"))
          ) {
            const parentStart = resolveStartForElementInternal(parent, fallback);
            startCache.set(element, parentStart);
            return parentStart;
          }
        }
        startCache.set(element, fallback);
        return fallback;
      }
      if (expression.kind === "absolute") {
        const absolute = Math.max(0, expression.value);
        const host = parentComposition(element);
        const trim = host ? readCompositionPlaybackStart(host) : 0;
        const resolved = Math.max(
          0,
          resolveHostOffsetForElement(element, fallback) +
            (absolute - trim) / resolveAncestorCompositionPlaybackRate(element),
        );
        startCache.set(element, resolved);
        return resolved;
      }
      const target = findReferenceTarget(expression.refId);
      if (!target) {
        startCache.set(element, fallback);
        return fallback;
      }
      const targetStart = resolveStartForElementInternal(target, 0);
      const targetDuration = resolveDurationForElement(target);
      if (targetDuration == null || targetDuration <= 0) {
        const unresolved = Math.max(
          0,
          targetStart + expression.offset / resolveAncestorCompositionPlaybackRate(element),
        );
        startCache.set(element, unresolved);
        return unresolved;
      }
      const resolved = Math.max(
        0,
        targetStart +
          targetDuration +
          expression.offset / resolveAncestorCompositionPlaybackRate(element),
      );
      startCache.set(element, resolved);
      return resolved;
    } finally {
      visiting.delete(element);
    }
  };

  return {
    resolveStartForElement: (element: Element, fallback = 0) =>
      resolveStartForElementInternal(element, Math.max(0, fallback)),
    resolveDurationForElement: (element: Element) => resolveDurationForElement(element),
  };
}
