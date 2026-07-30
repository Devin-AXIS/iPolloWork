import { memo } from "react";
import type {
  TimelineAnimationPhase,
  TimelineAnimationSegment,
} from "../../utils/timelineAnimationSegments";

const PHASE_STYLE: Record<
  TimelineAnimationPhase,
  { background: string; label: string }
> = {
  entrance: { background: "rgba(34, 211, 238, 0.72)", label: "Entrance" },
  loop: { background: "rgba(250, 204, 21, 0.68)", label: "Loop" },
  exit: { background: "rgba(244, 114, 182, 0.72)", label: "Exit" },
};

export const TimelineClipAnimationSegments = memo(function TimelineClipAnimationSegments({
  segments,
}: {
  segments: readonly TimelineAnimationSegment[];
}) {
  if (segments.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-1 bottom-1 z-[3] h-1.5 overflow-hidden rounded-full bg-black/10"
    >
      {segments.map((segment) => {
        const phaseStyle = PHASE_STYLE[segment.phase];
        return (
          <span
            key={segment.animationId}
            data-animation-id={segment.animationId}
            data-animation-phase={segment.phase}
            className="absolute inset-y-0 rounded-full"
            title={`${phaseStyle.label} animation`}
            style={{
              left: `${segment.startPercentage}%`,
              width: `${Math.max(0.8, segment.endPercentage - segment.startPercentage)}%`,
              background: phaseStyle.background,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.28) inset",
            }}
          />
        );
      })}
    </div>
  );
});
