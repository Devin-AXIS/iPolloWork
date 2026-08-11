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
        parameters,
      }),
      target.textContent ?? "",
    );
  } catch {
    return undefined;
  }
  if (!compiled.structured) return undefined;

  const timeline = gsap.timeline?.({ paused: true, repeat: loop ? -1 : 0 });
  if (!timeline?.to || !timeline.set) return undefined;

  const snapshot = snapshotStructuredText(target);
  const structuredTargets = new Set<HTMLElement>();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    timeline.kill?.();
    clearStructuredPreviewStyles(structuredTargets);
    restoreStructuredText(target, snapshot);
  };

  try {
    materializeStructuredText(target, compiled.structured, target.textContent ?? "");
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
    timeline.play?.(0);
  } catch {
    cleanup();
    return undefined;
  }

  return { timeline, cleanup };
}
