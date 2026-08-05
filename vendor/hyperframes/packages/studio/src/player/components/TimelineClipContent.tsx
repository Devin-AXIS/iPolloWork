import { memo, type ReactNode } from "react";

type TimelineClipContentVariant = "bar" | "media" | "audio";

interface TimelineClipContentProps {
  label: string;
  timecode?: string;
  variant?: TimelineClipContentVariant;
  body?: ReactNode;
}

export const TimelineClipContent = memo(function TimelineClipContent({
  label,
  timecode,
  variant = "bar",
  body,
}: TimelineClipContentProps) {
  return (
    <div className={`hf-timeline-clip-content is-${variant}`}>
      <div className="hf-timeline-clip-content__header">
        <span className="hf-timeline-clip-content__label">{label}</span>
        {timecode && <span className="hf-timeline-clip-content__timecode">{timecode}</span>}
      </div>
      {body && <div className="hf-timeline-clip-content__body">{body}</div>}
    </div>
  );
});
