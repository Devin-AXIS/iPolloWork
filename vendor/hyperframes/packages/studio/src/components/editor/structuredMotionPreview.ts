import {
  compileMotionInstance,
  createMotionInstance,
  materializeStructuredText,
  restoreStructuredText,
  snapshotStructuredText,
  type MotionParameters,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";

export type StructuredMotionPreviewTarget = HTMLElement | HTMLElement[];

export interface StructuredMotionPreviewTimeline {
  to?: (
    target: StructuredMotionPreviewTarget,
    vars: Record<string, unknown>,
    position: number,
  ) => StructuredMotionPreviewTimeline;
  set?: (
    target: StructuredMotionPreviewTarget,
    vars: Record<string, unknown>,
    position: number,
  ) => StructuredMotionPreviewTimeline;
  play?: (position?: number) => StructuredMotionPreviewTimeline;
  progress?: (value: number) => StructuredMotionPreviewTimeline;
  eventCallback?: (type: "onComplete", callback: () => void) => StructuredMotionPreviewTimeline;
  kill?: () => void;
}

export interface StructuredMotionPreviewGsap {
  timeline?: (options: Record<string, unknown>) => StructuredMotionPreviewTimeline;
}

export interface StructuredMotionPreviewOptions {
  target: HTMLElement;
  presetId: string;
  targetKind: MotionTargetKind;
  parameters: MotionParameters;
  duration: number;
  loop: boolean;
  gsap: StructuredMotionPreviewGsap;
}

export interface StructuredMotionPreviewHandle {
  timeline: StructuredMotionPreviewTimeline;
  cleanup: () => void;
}

export interface MotionTextPreviewParts {
  targets: HTMLElement[];
  restore: () => void;
}

interface MotionPreviewFrameWindow {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/**
 * Video compositions pause GSAP's global timeline while the player is paused.
 * Preview timelines therefore need their own frame driver. A short final hold
 * makes loop previews readable instead of flashing at the cycle boundary.
 */
export function driveMotionPreviewTimeline({
  timeline,
  duration,
  loop,
  holdDuration = 0,
  view,
  onComplete,
}: {
  timeline: StructuredMotionPreviewTimeline;
  duration: number;
  loop: boolean;
  holdDuration?: number;
  view: MotionPreviewFrameWindow | null;
  onComplete?: () => void;
}): () => void {
  const requestFrame = view?.requestAnimationFrame?.bind(view);
  const cancelFrame = view?.cancelAnimationFrame?.bind(view);
  if (!timeline.progress || !requestFrame) {
    if (!loop && onComplete) timeline.eventCallback?.("onComplete", onComplete);
    timeline.play?.(0);
    return () => undefined;
  }

  const activeDurationMs = Math.max(1, duration * 1000);
  const holdDurationMs = loop ? Math.max(0, holdDuration * 1000) : 0;
  const cycleDurationMs = activeDurationMs + holdDurationMs;
  let frame = 0;
  let cycleStartedAt: number | null = null;
  let stopped = false;
  timeline.progress(0);

  const drive = (timestamp: number) => {
    if (stopped) return;
    cycleStartedAt ??= timestamp;
    const elapsed = Math.max(0, timestamp - cycleStartedAt);
    timeline.progress?.(Math.min(1, elapsed / activeDurationMs));
    if (elapsed >= cycleDurationMs) {
      if (!loop) {
        stopped = true;
        onComplete?.();
        return;
      }
      cycleStartedAt = timestamp;
      timeline.progress?.(0);
    }
    frame = requestFrame(drive);
  };
  frame = requestFrame(drive);

  return () => {
    stopped = true;
    if (frame) cancelFrame?.(frame);
  };
}

export function materializeMotionTextPreviewParts(
  target: HTMLElement,
  unit: string,
): MotionTextPreviewParts {
  if (unit === "whole") return { targets: [target], restore: () => undefined };
  const snapshot = snapshotStructuredText(target);
  const source = target.textContent ?? "";
  const granularity = unit === "character" ? "grapheme" : "word";
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "word" | "grapheme" },
      ) => { segment: (text: string) => Iterable<{ segment: string }> };
    }
  ).Segmenter;
  const segments = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity }).segment(source), (part) => part.segment)
    : Array.from(source);
  const fragment = target.ownerDocument.createDocumentFragment();
  const targets: HTMLElement[] = [];
  for (const segment of segments) {
    if (/^\s+$/u.test(segment)) {
      fragment.append(target.ownerDocument.createTextNode(segment));
      continue;
    }
    const part = target.ownerDocument.createElement("span");
    part.style.display = "inline-block";
    part.style.whiteSpace = "pre";
    part.style.font = "inherit";
    part.style.fontWeight = "inherit";
    part.style.lineHeight = "inherit";
    part.style.letterSpacing = "inherit";
    part.style.color = "inherit";
    part.style.setProperty("-webkit-text-stroke", "inherit");
    part.textContent = segment;
    targets.push(part);
    fragment.append(part);
  }
  target.replaceChildren(fragment);
  return {
    targets,
    restore: () => restoreStructuredText(target, snapshot),
  };
}

function keyframesForPreview(
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }>,
): Record<string, Record<string, number | string>> {
  return Object.fromEntries(
    keyframes.map((frame) => [
      `${frame.percentage}%`,
      { ...frame.properties, ...(frame.ease ? { ease: frame.ease } : {}) },
    ]),
  );
}

function clearStructuredPreviewStyles(targets: Iterable<HTMLElement>): void {
  for (const target of targets) target.removeAttribute("style");
}

function applyStructuredMotionPresentation(target: HTMLElement): void {
  target.setAttribute("data-ipw-motion-presentation", "text-v1");
  for (const layer of target.querySelectorAll<HTMLElement>(
    '[data-ipw-motion-role="text"], [data-ipw-motion-role="clone-primary"], [data-ipw-motion-role="clone-accent"]',
  )) {
    layer.style.fontWeight = "inherit";
    layer.style.lineHeight = "inherit";
    layer.style.letterSpacing = "inherit";
    layer.style.color = "inherit";
    layer.style.setProperty("-webkit-text-stroke", "inherit");
  }
}

export function previewStructuredMotion({
  target,
  presetId,
  targetKind,
  parameters,
  duration,
  loop,
  gsap,
}: StructuredMotionPreviewOptions): StructuredMotionPreviewHandle | undefined {
  let compiled: ReturnType<typeof compileMotionInstance>;
  try {
    compiled = compileMotionInstance(
      createMotionInstance({
        presetId,
        target: { selector: "[data-ipw-motion-preview]" },
        targetKind,
        start: 0,
        duration,
        loop,
        parameters,
      }),
      target.textContent ?? "",
    );
  } catch {
    return undefined;
  }
  if (!compiled.structured) return undefined;

  const timeline = gsap.timeline?.({ paused: true });
  if (!timeline?.to || !timeline.set) return undefined;

  const snapshot = snapshotStructuredText(target);
  const structuredTargets = new Set<HTMLElement>();
  let cleaned = false;
  let stopDriving: () => void = () => undefined;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    stopDriving();
    timeline.kill?.();
    clearStructuredPreviewStyles(structuredTargets);
    restoreStructuredText(target, snapshot);
  };

  try {
    materializeStructuredText(target, compiled.structured, target.textContent ?? "");
    applyStructuredMotionPresentation(target);
    for (const track of compiled.structured.tracks) {
      const targets = Array.from(
        target.querySelectorAll<HTMLElement>(`[data-ipw-motion-role="${track.role}"]`),
      );
      if (targets.length === 0) continue;
      targets.forEach((roleTarget) => structuredTargets.add(roleTarget));
      if (track.duration === 0) {
        const properties = track.keyframes.at(-1)?.properties ?? {};
        timeline.set(
          targets,
          { ...properties, ...(track.stagger > 0 ? { stagger: track.stagger } : {}) },
          track.position,
        );
        continue;
      }
      timeline.to(
        targets,
        {
          keyframes: keyframesForPreview(track.keyframes),
          duration: track.duration,
          ...(track.stagger > 0 ? { stagger: track.stagger } : {}),
        },
        track.position,
      );
    }
    stopDriving = driveMotionPreviewTimeline({
      timeline,
      duration: Math.max(
        ...compiled.structured.tracks.map((track) => {
          const targetCount = target.querySelectorAll<HTMLElement>(
            `[data-ipw-motion-role="${track.role}"]`,
          ).length;
          return track.position + track.duration + track.stagger * Math.max(0, targetCount - 1);
        }),
        0,
      ),
      loop,
      holdDuration: duration * 0.2,
      view: target.ownerDocument.defaultView,
      onComplete: loop ? undefined : cleanup,
    });
  } catch {
    cleanup();
    return undefined;
  }

  return { timeline, cleanup };
}
