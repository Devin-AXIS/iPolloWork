import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import {
  compileMotionInstance,
  createMotionInstance,
  type MotionParameters,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import {
  driveMotionPreviewTimeline,
  materializeMotionTextPreviewParts,
  previewStructuredMotion,
} from "../editor/structuredMotionPreview";

function previewKeyframes(
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

export function StructuredMotionThumbnail({
  presetId,
  targetKind,
  parameters,
  duration,
}: {
  presetId: string;
  targetKind: MotionTargetKind;
  parameters: MotionParameters;
  duration: number;
}) {
  const targetRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const startPreview = (): (() => void) => {
      const preview = previewStructuredMotion({
        target,
        presetId,
        targetKind,
        parameters,
        duration,
        loop: true,
        gsap,
      });
      if (preview) return preview.cleanup;

      const source = target.textContent ?? "";
      const originalStyle = target.getAttribute("style");
      try {
        const compiled = compileMotionInstance(
          createMotionInstance({
            presetId,
            target: { selector: "[data-ipw-motion-thumbnail]" },
            targetKind,
            start: 0,
            duration,
            parameters,
          }),
          source,
        );
        const previewParts = materializeMotionTextPreviewParts(
          target,
          String(parameters.unit ?? "whole"),
        );
        const timeline = gsap.timeline({ paused: true });
        timeline.to(
          previewParts.targets,
          {
            keyframes: previewKeyframes(compiled.keyframes),
            duration: compiled.duration,
            ease: compiled.ease,
            ...(typeof compiled.extras.stagger === "number"
              ? { stagger: compiled.extras.stagger }
              : {}),
          },
          0,
        );
        const stopDriving = driveMotionPreviewTimeline({
          timeline,
          duration,
          loop: true,
          view: target.ownerDocument.defaultView,
        });
        return () => {
          stopDriving();
          timeline.kill();
          previewParts.restore();
          if (originalStyle === null) target.removeAttribute("style");
          else target.setAttribute("style", originalStyle);
        };
      } catch {
        target.textContent = source;
        if (originalStyle === null) target.removeAttribute("style");
        else target.setAttribute("style", originalStyle);
        return () => undefined;
      }
    };

    const view = target.ownerDocument.defaultView;
    const PreviewObserver = view?.IntersectionObserver;
    if (!PreviewObserver) return startPreview();

    let stopPreview: () => void = () => undefined;
    let previewRunning = false;
    const observer = new PreviewObserver(
      ([entry]) => {
        const shouldRun = Boolean(entry?.isIntersecting);
        if (shouldRun === previewRunning) return;
        previewRunning = shouldRun;
        if (shouldRun) {
          stopPreview = startPreview();
          return;
        }
        stopPreview();
        stopPreview = () => undefined;
      },
      { rootMargin: "160px 0px" },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      stopPreview();
    };
  }, [duration, parameters, presetId, targetKind]);

  return (
    <span ref={targetRef} data-ipw-motion-thumbnail>
      Make motion clear.
    </span>
  );
}
