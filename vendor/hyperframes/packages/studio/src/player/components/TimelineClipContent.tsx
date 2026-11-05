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
    <div className={`hf-timeline-clip-content is-${variant}`} aria-label={label} title={timecode ? `${label} • ${timecode}` : label}>
      {body && <div className="hf-timeline-clip-content__body" style={{ inset: 0 }}>{body}</div>}
    </div>
  );
});
