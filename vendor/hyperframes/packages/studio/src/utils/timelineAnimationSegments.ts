import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { resolveTweenDuration, resolveTweenStart } from "./globalTimeCompiler";

export type TimelineAnimationPhase = "entrance" | "loop" | "exit";

export interface TimelineAnimationOwnerRange {
  start: number;
  duration: number;
}

export interface TimelineAnimationSegment {
  animationId: string;
  phase: TimelineAnimationPhase;
  startPercentage: number;
  endPercentage: number;
}

export interface GsapAnimationMetaUpdate {
  duration?: number;
  ease?: string;
  position?: number;
}

const EDGE_EPSILON_SECONDS = 0.001;

export function isAnimationSharedForOwner(
  animation: GsapAnimation,
  ownerId: string | null | undefined,
): boolean {
  if (!ownerId) return true;
  const selectorParts = animation.targetSelector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return selectorParts.length !== 1 || selectorParts[0] !== `#${ownerId}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNumericExtra(animation: GsapAnimation, key: string): number | null {
  const value = animation.extras?.[key];
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const normalized = value.startsWith("__raw:") ? value.slice(6) : value;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveRepeatCount(animation: GsapAnimation): number {
  return readNumericExtra(animation, "repeat") ?? 0;
}

function resolveAnimationSpanForDuration(
  animation: GsapAnimation,
  duration: number,
): number {
  const repeat = resolveRepeatCount(animation);
  if (repeat < 0) return Number.POSITIVE_INFINITY;
  const repeatCount = Math.max(0, Math.floor(repeat));
  const repeatDelay = Math.max(0, readNumericExtra(animation, "repeatDelay") ?? 0);
  return duration * (repeatCount + 1) + repeatDelay * repeatCount;
}

function resolveAnimationSpan(animation: GsapAnimation): number {
  return resolveAnimationSpanForDuration(animation, resolveTweenDuration(animation));
}

function maxBaseDurationForSpan(animation: GsapAnimation, availableSpan: number): number {
  const repeat = resolveRepeatCount(animation);
  if (repeat < 0) return Math.max(0, availableSpan);
  const repeatCount = Math.max(0, Math.floor(repeat));
  const repeatDelay = Math.max(0, readNumericExtra(animation, "repeatDelay") ?? 0);
  return Math.max(
    0,
    (availableSpan - repeatDelay * repeatCount) / (repeatCount + 1),
  );
}

function hasLoopConfiguration(animation: GsapAnimation): boolean {
  if (animation.provenance?.kind === "loop") return true;
  return resolveRepeatCount(animation) !== 0;
}

function hidesElement(animation: GsapAnimation): boolean {
  const opacity = animation.properties.opacity ?? animation.properties.autoAlpha;
  const visibility = animation.properties.visibility;
  const display = animation.properties.display;
  return (
    Number(opacity) === 0 ||
    visibility === "hidden" ||
    visibility === "collapse" ||
    display === "none"
  );
}

export function resolveTimelineAnimationPhase(
  animation: GsapAnimation,
  ownerRange: TimelineAnimationOwnerRange,
): TimelineAnimationPhase {
  if (hasLoopConfiguration(animation)) return "loop";

  const animationStart = resolveTweenStart(animation);
  if (animationStart === null || ownerRange.duration <= 0) return "loop";
  const animationEnd = animationStart + resolveAnimationSpan(animation);
  const ownerEnd = ownerRange.start + ownerRange.duration;
  const tolerance = Math.max(
    EDGE_EPSILON_SECONDS,
    Math.min(0.15, ownerRange.duration * 0.02),
  );
  const touchesStart =
    animationStart <= ownerRange.start + tolerance && animationEnd > ownerRange.start;
  const touchesEnd = animationEnd >= ownerEnd - tolerance && animationStart < ownerEnd;

  if (touchesStart && (animation.method === "from" || animation.method === "fromTo")) {
    return "entrance";
  }
  if (touchesEnd && hidesElement(animation)) return "exit";
  if (touchesStart && !touchesEnd) return "entrance";
  if (touchesEnd && !touchesStart) return "exit";
  return "loop";
}

export function buildTimelineAnimationSegment(
  animation: GsapAnimation,
  ownerRange: TimelineAnimationOwnerRange,
): TimelineAnimationSegment | null {
  if (animation.method === "set" || ownerRange.duration <= 0) return null;
  const animationStart = resolveTweenStart(animation);
  const animationDuration = resolveAnimationSpan(animation);
  if (animationStart === null || animationDuration <= 0) return null;

  const ownerEnd = ownerRange.start + ownerRange.duration;
  const boundedStart = clamp(animationStart, ownerRange.start, ownerEnd);
  const boundedEnd = clamp(animationStart + animationDuration, ownerRange.start, ownerEnd);
  if (boundedEnd <= boundedStart) return null;

  return {
    animationId: animation.id,
    phase: resolveTimelineAnimationPhase(animation, ownerRange),
    startPercentage: ((boundedStart - ownerRange.start) / ownerRange.duration) * 100,
    endPercentage: ((boundedEnd - ownerRange.start) / ownerRange.duration) * 100,
  };
}

export function buildTimelineAnimationSegments(
  animations: readonly GsapAnimation[],
  ownerRange: TimelineAnimationOwnerRange,
): TimelineAnimationSegment[] {
  const segments = new Map<string, TimelineAnimationSegment>();
  for (const animation of animations) {
    const segment = buildTimelineAnimationSegment(animation, ownerRange);
    if (segment) segments.set(segment.animationId, segment);
  }
  return Array.from(segments.values()).sort(
    (left, right) =>
      left.startPercentage - right.startPercentage ||
      left.endPercentage - right.endPercentage ||
      left.animationId.localeCompare(right.animationId),
  );
}

/**
 * Keep an animation inside its owner clip. The card still emits one existing
 * GSAP meta mutation; this helper only normalizes the edited timing fields.
 */
export function clampAnimationMetaToOwner(
  animation: GsapAnimation,
  updates: GsapAnimationMetaUpdate,
  ownerRange: TimelineAnimationOwnerRange | undefined,
): GsapAnimationMetaUpdate {
  if (!ownerRange || ownerRange.duration <= 0) return updates;

  const ownerEnd = ownerRange.start + ownerRange.duration;
  const currentStart = resolveTweenStart(animation) ?? ownerRange.start;
  const currentDuration = resolveTweenDuration(animation);
  const requestedDuration = updates.duration ?? currentDuration;
  const duration = clamp(requestedDuration, 0, ownerRange.duration);
  const requestedPosition = updates.position ?? currentStart;
  const requestedSpan = resolveAnimationSpanForDuration(animation, duration);
  const position =
    updates.position !== undefined && updates.duration === undefined
      ? clamp(
          requestedPosition,
          ownerRange.start,
          ownerEnd - Math.min(ownerRange.duration, requestedSpan),
        )
      : clamp(requestedPosition, ownerRange.start, ownerEnd);
  const boundedDuration = Math.min(
    duration,
    maxBaseDurationForSpan(animation, ownerEnd - position),
  );
  const positionChanged = updates.position !== undefined || position !== currentStart;
  const durationChanged = updates.duration !== undefined || boundedDuration !== currentDuration;

  return {
    ...(updates.ease !== undefined ? { ease: updates.ease } : {}),
    ...(positionChanged ? { position } : {}),
    ...(durationChanged ? { duration: boundedDuration } : {}),
  };
}
