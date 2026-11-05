import { lastVideoFrameTime } from "@hyperframes/core/runtime/protocol";
import { parseNumeric, parseStartExpression } from "@hyperframes/core/runtime/start-expression";

import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { PlaybackAdapter } from "./playbackTypes";

type InlineState = { display: string };

const AUTHORED_DURATION_ATTR = "data-hf-authored-duration";
const AUTHORED_END_ATTR = "data-hf-authored-end";

const originalInlineState = new WeakMap<Document, Map<HTMLElement, InlineState>>();
const visibilityAdapterCache = new WeakMap<PlaybackAdapter, PlaybackAdapter>();

function legacyFrameDuration(frame: HTMLElement): number {
  const value = Number(frame.getAttribute("data-duration"));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Older generated templates run their own `.frame.active` carousel instead of
 * exposing each scene to the HyperFrames timeline. Studio owns transport, so
 * map its playhead onto those authored frame-duration weights and force one
 * exact frame visible. Inline opacity/visibility bypasses cross-fade remnants
 * when the user seeks while playback is running.
 */
export function syncLegacyFrameCarousel(
  doc: Document | null | undefined,
  currentTime: number,
  timelineDuration: number,
): void {
  if (!doc || !Number.isFinite(currentTime) || timelineDuration <= 0) return;
  const frames = Array.from(doc.querySelectorAll<HTMLElement>(".frame"));
  if (frames.length < 2) return;

  const durations = frames.map(legacyFrameDuration);
  const authoredDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const normalizedTime = Math.min(Math.max(currentTime, 0), timelineDuration);
  const authoredTime = (normalizedTime / timelineDuration) * authoredDuration;
  let activeIndex = frames.length - 1;
  let boundary = 0;
  for (let index = 0; index < durations.length; index++) {
    boundary += durations[index];
    if (authoredTime < boundary) {
      activeIndex = index;
      break;
    }
  }

  frames.forEach((frame, index) => {
    const active = index === activeIndex;
    frame.classList.toggle("active", active);
    frame.style.setProperty("transition", "none", "important");
    frame.style.setProperty("opacity", active ? "1" : "0", "important");
    frame.style.setProperty("visibility", active ? "visible" : "hidden", "important");
    frame.style.setProperty("pointer-events", active ? "auto" : "none", "important");
  });
}

function stateForDocument(doc: Document): Map<HTMLElement, InlineState> {
  let state = originalInlineState.get(doc);
  if (!state) {
    state = new Map();
    originalInlineState.set(doc, state);
  }
  return state;
}

function rememberInlineState(
  state: Map<HTMLElement, InlineState>,
  element: HTMLElement,
): InlineState {
  let original = state.get(element);
  if (!original) {
    original = {
      display:
        element.style.getPropertyValue("display") === "none"
          ? ""
          : element.style.getPropertyValue("display"),
    };
    state.set(element, original);
  }
  return original;
}

function restoreProperty(
  style: CSSStyleDeclaration,
  property: "display" | "visibility",
  value: string,
) {
  if (value) style.setProperty(property, value);
  else style.removeProperty(property);
}

function resolveTimedWindows(doc: Document) {
  const startCache = new WeakMap<Element, number>();
  const durationCache = new WeakMap<Element, number>();
  const resolving = new Set<Element>();

  const resolveTarget = (id: string) =>
    doc.getElementById(id) ??
    Array.from(doc.querySelectorAll("[data-composition-id]")).find(
      (element) => element.getAttribute("data-composition-id") === id,
    ) ??
    null;

  const resolveDuration = (element: Element): number => {
    const cached = durationCache.get(element);
    if (cached !== undefined) return cached;
    const duration = parseNumeric(
      element.getAttribute("data-duration") ?? element.getAttribute(AUTHORED_DURATION_ATTR),
    );
    if (duration != null && duration > 0) {
      durationCache.set(element, duration);
      return duration;
    }
    const end = parseNumeric(
      element.getAttribute("data-end") ?? element.getAttribute(AUTHORED_END_ATTR),
    );
    const resolved = end != null ? Math.max(0, end - resolveStart(element)) : 0;
    durationCache.set(element, resolved);
    return resolved;
  };

  const resolveHostOffset = (element: Element): number => {
    const host = element.hasAttribute("data-composition-id")
      ? element.parentElement?.closest("[data-composition-id]")
      : element.closest("[data-composition-id]");
    return host && host !== element ? resolveStart(host) : 0;
  };

  const resolveStart = (element: Element): number => {
    const cached = startCache.get(element);
    if (cached !== undefined) return cached;
    if (resolving.has(element)) return 0;
    resolving.add(element);
    try {
      const expression = parseStartExpression(element.getAttribute("data-start"));
      if (!expression) return 0;
      if (expression.kind === "absolute") {
        const value = Math.max(0, resolveHostOffset(element) + expression.value);
        startCache.set(element, value);
        return value;
      }
      const target = resolveTarget(expression.refId);
      const value = target
        ? Math.max(0, resolveStart(target) + resolveDuration(target) + expression.offset)
        : 0;
      startCache.set(element, value);
      return value;
    } finally {
      resolving.delete(element);
    }
  };

  return { resolveDuration, resolveStart };
}

export interface ElementVisibleTiming {
  start: number;
  duration: number;
}

/** Resolve the interval where an element and every timed ancestor are visible. */
export function resolveElementVisibleTiming(element: Element): ElementVisibleTiming | null {
  const { resolveDuration, resolveStart } = resolveTimedWindows(element.ownerDocument);
  let visibleStart = 0;
  let visibleEnd = Infinity;
  let foundTimedWindow = false;
  let current: Element | null = element;

  while (current) {
    const duration = resolveDuration(current);
    if (duration > 0) {
      const start = resolveStart(current);
      visibleStart = Math.max(visibleStart, start);
      visibleEnd = Math.min(visibleEnd, start + duration);
      foundTimedWindow = true;
    }
    current = current.parentElement;
  }

  if (!foundTimedWindow || !Number.isFinite(visibleEnd) || visibleEnd <= visibleStart) return null;
  return { start: visibleStart, duration: visibleEnd - visibleStart };
}

function isInFlow(element: HTMLElement, win: Window): boolean {
  const position = win.getComputedStyle(element).position;
  return position === "static" || position === "relative" || position === "sticky";
}

function isLeafTimedClip(element: HTMLElement): boolean {
  return element.querySelector("[data-start]") === null;
}

function topLevelTimedClip(element: HTMLElement, timed: Set<HTMLElement>): HTMLElement {
  let current = element;
  let ancestor = element.parentElement;
  while (ancestor) {
    if (!timed.has(ancestor) || ancestor.hasAttribute("data-composition-id")) break;
    current = ancestor;
    ancestor = ancestor.parentElement;
  }
  return current;
}

function clipTrack(element: HTMLElement): string {
  return element.getAttribute("data-track-index") ?? element.getAttribute("data-track") ?? "0";
}

function exclusiveGroup(element: HTMLElement): string {
  const parent = element.parentElement;
  const composition = parent?.getAttribute("data-composition-id") ?? "root";
  return element.matches(".scene, [data-scene]")
    ? `${composition}:scene`
    : `${composition}:track:${clipTrack(element)}`;
}

function participatesInExclusiveTiming(element: HTMLElement): boolean {
  return (
    element.classList.contains("clip") ||
    element.hasAttribute("data-track-index") ||
    element.hasAttribute("data-track")
  );
}

function activeNarratedScene(
  doc: Document,
  currentTime: number,
  resolveStart: (element: Element) => number,
  resolveDuration: (element: Element) => number,
): HTMLElement | null {
  let winner: { scene: HTMLElement; start: number } | null = null;
  const voiceovers = doc.querySelectorAll<HTMLElement>('audio[data-ipw-voiceover="true"]');
  for (const voiceover of voiceovers) {
    const sceneId = voiceover.getAttribute("data-ipw-scene-id")?.trim();
    const sceneText = voiceover.getAttribute("data-ipw-scene-text")?.trim();
    const narrationText = voiceover.getAttribute("data-ipw-narration-text")?.trim();
    if (!sceneId || !sceneText || narrationText !== sceneText) continue;
    const scene = doc.getElementById(sceneId);
    if (!(scene instanceof HTMLElement) || !scene.matches(".scene, [data-scene]")) continue;
    const start = resolveStart(voiceover);
    const duration = resolveDuration(voiceover);
    if (
      duration <= 0 ||
      Math.abs(start - resolveStart(scene)) >= 0.001 ||
      currentTime < start ||
      currentTime >= start + duration
    )
      continue;
    if (!winner || start >= winner.start) winner = { scene, start };
  }
  return winner?.scene ?? null;
}

export function syncTimedClipVisibility(
  doc: Document | null | undefined,
  currentTime: number,
  sceneScope?: Element | null,
): void {
  if (!doc || !Number.isFinite(currentTime)) return;
  const win = doc.defaultView;
  if (!win) return;
  const state = stateForDocument(doc);
  const timed = new Set(
    Array.from(doc.querySelectorAll<HTMLElement>("[data-start]")).filter(
      (element) =>
        !["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"].includes(element.tagName),
    ),
  );

  for (const [element, original] of state) {
    if (element.isConnected && timed.has(element)) continue;
    restoreProperty(element.style, "display", original.display);
    element.style.removeProperty("visibility");
    state.delete(element);
  }

  const { resolveDuration, resolveStart } = resolveTimedWindows(doc);
  const narratedScene = activeNarratedScene(doc, currentTime, resolveStart, resolveDuration);
  const narratedSceneGroup = narratedScene ? exclusiveGroup(narratedScene) : null;
  const active = new Map<HTMLElement, boolean>();
  for (const element of timed) {
    const start = resolveStart(element);
    const duration = resolveDuration(element);
    const retainedByNarration = Boolean(
      narratedScene &&
      (element === narratedScene || narratedScene.contains(element)) &&
      currentTime >= start,
    );
    active.set(
      element,
      retainedByNarration ||
        (duration > 0 && currentTime >= start && currentTime < start + duration),
    );
  }

  const winningTopLevelClip = new Map<string, { element: HTMLElement; start: number }>();
  for (const element of timed) {
    if (
      active.get(element) !== true ||
      topLevelTimedClip(element, timed) !== element ||
      !participatesInExclusiveTiming(element)
    )
      continue;
    const key = exclusiveGroup(element);
    const start = resolveStart(element);
    const winner = winningTopLevelClip.get(key);
    if (
      element === sceneScope ||
      element === narratedScene ||
      ((sceneScope == null || winner?.element !== sceneScope) &&
        key !== narratedSceneGroup &&
        (!winner || start >= winner.start))
    ) {
      winningTopLevelClip.set(key, { element, start });
    }
  }

  for (const element of timed) {
    const original = rememberInlineState(state, element);
    if (element.hasAttribute("data-hidden")) {
      element.style.display = "none";
      element.style.visibility = "hidden";
      continue;
    }

    let visible = active.get(element) === true;
    const topLevel = topLevelTimedClip(element, timed);
    const topKey = exclusiveGroup(topLevel);
    if (
      visible &&
      participatesInExclusiveTiming(topLevel) &&
      winningTopLevelClip.get(topKey)?.element !== topLevel
    )
      visible = false;
    if (visible) {
      let ancestor = element.parentElement;
      while (ancestor) {
        if (timed.has(ancestor) && active.get(ancestor) !== true) {
          visible = false;
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    element.style.visibility = visible ? "visible" : "hidden";
    if (visible || !isInFlow(element, win) || !isLeafTimedClip(element)) {
      restoreProperty(element.style, "display", original.display);
    } else {
      element.style.display = "none";
    }
  }
}

const SCENE_SELECTOR = '.scene, [data-timeline-kind="scene"], [data-timeline-role="scene"]';
const scopedMediaState = new WeakMap<Document, Map<HTMLMediaElement, boolean>>();

/** Preview-only isolation. Shared composition layers remain visible; no authored attributes change. */
export function syncPreviewSceneScope(
  doc: Document | null | undefined,
  scope: TimelineElement | null,
  audioMuted?: boolean,
): Element | null {
  if (!doc) return null;
  let target: Element | null = null;
  if (scope) {
    target = scope.hfId ? doc.querySelector(`[data-hf-id="${CSS.escape(scope.hfId)}"]`) : null;
    target ??= doc.getElementById(scope.domId ?? scope.id);
    if (!target && scope.selector) {
      try {
        target = doc.querySelectorAll(scope.selector)[scope.selectorIndex ?? 0] ?? null;
      } catch {
        /* unsupported selector */
      }
    }
  }
  const scenes = Array.from(doc.querySelectorAll(SCENE_SELECTOR));
  for (const scene of scenes) {
    scene.toggleAttribute(
      "data-hf-studio-scope-hidden",
      Boolean(target && scene !== target && !scene.contains(target) && !target.contains(scene)),
    );
  }
  let mask = doc.querySelector("style[data-hf-studio-scene-mask]");
  if (target && !mask) {
    mask = doc.createElement("style");
    mask.setAttribute("data-hf-studio-scene-mask", "");
    mask.textContent =
      "[data-hf-studio-scope-hidden] { display: none !important; pointer-events: none !important; }";
    (doc.head ?? doc.documentElement).append(mask);
  } else if (!target) mask?.remove();
  const mediaState = scopedMediaState.get(doc) ?? new Map<HTMLMediaElement, boolean>();
  scopedMediaState.set(doc, mediaState);
  for (const [media, muted] of mediaState) {
    if (
      !target ||
      !media.isConnected ||
      (!media.closest("[data-hf-studio-scope-hidden]") &&
        (!media.getAttribute("data-ipw-scene-id") ||
          media.getAttribute("data-ipw-scene-id") === (scope?.domId ?? scope?.id)))
    ) {
      media.muted = audioMuted ?? muted;
      mediaState.delete(media);
    }
  }
  if (target) {
    for (const media of doc.querySelectorAll<HTMLMediaElement>("audio, video")) {
      const relatedScene = media.getAttribute("data-ipw-scene-id");
      const outsideScene =
        media.closest("[data-hf-studio-scope-hidden]") ||
        (relatedScene && relatedScene !== (scope?.domId ?? scope?.id));
      if (!outsideScene) continue;
      if (!mediaState.has(media)) mediaState.set(media, media.muted);
      media.muted = true;
      media.pause();
    }
  }
  return target;
}

export function wrapAdapterWithTimedClipVisibility(
  adapter: PlaybackAdapter,
  getDocument: () => Document | null | undefined,
  fps = 30,
  getSceneScope?: () => TimelineElement | null,
): PlaybackAdapter {
  const cached = visibilityAdapterCache.get(adapter);
  if (cached) return cached;
  const sync = (time = adapter.getTime()) => {
    const doc = getDocument();
    const scope = getSceneScope?.() ?? null;
    const visualTime = scope
      ? Math.max(
          scope.start,
          lastVideoFrameTime(time - scope.start, scope.duration, fps) + scope.start,
        )
      : lastVideoFrameTime(time, adapter.getDuration(), fps);
    const target = syncPreviewSceneScope(doc, scope, usePlayerStore.getState().audioMuted);
    syncTimedClipVisibility(doc, visualTime, target);
    syncLegacyFrameCarousel(doc, visualTime, adapter.getDuration());
    syncPreviewSceneScope(doc, scope, usePlayerStore.getState().audioMuted);
  };
  const wrapped: PlaybackAdapter = {
    play: () => {
      sync();
      adapter.play();
    },
    pause: () => adapter.pause(),
    seek: (time, options) => {
      const scope = getSceneScope?.() ?? null;
      const seekTime = scope
        ? Math.max(scope.start, Math.min(scope.start + scope.duration - 1 / fps, time))
        : time;
      adapter.seek(seekTime, options);
      sync(seekTime);
    },
    getTime: () => {
      const time = adapter.getTime();
      sync(time);
      return time;
    },
    getDuration: () => adapter.getDuration(),
    isPlaying: () => adapter.isPlaying(),
  };
  visibilityAdapterCache.set(adapter, wrapped);
  return wrapped;
}
