import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { MotionParameters, MotionTargetKind } from "@hyperframes/core/motion-presets";
import { previewStructuredMotion } from "../editor/structuredMotionPreview";

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
    const preview = previewStructuredMotion({
      target,
      presetId,
      targetKind,
      parameters,
      duration,
      loop: true,
      gsap,
    });
    return preview?.cleanup;
  }, [duration, parameters, presetId, targetKind]);

  return <span ref={targetRef}>Make motion clear.</span>;
}
