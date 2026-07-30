import { memo, type ReactNode } from "react";
import {
  Cube,
  ImageSquare,
  Microphone,
  MusicNotes,
  Sparkle,
  Stack,
  TextT,
  VideoCamera,
  Waveform,
} from "@phosphor-icons/react";
import type { TimelineKind } from "../store/playerStore";

export function TimelineKindIcon({
  kind,
  size = 14,
}: {
  kind: TimelineKind;
  size?: number;
}) {
  if (kind === "text") return <TextT size={size} weight="bold" />;
  if (kind === "effect") return <Sparkle size={size} weight="fill" />;
  if (kind === "music") return <MusicNotes size={size} weight="fill" />;
  if (kind === "voiceover") return <Microphone size={size} weight="fill" />;
  if (kind === "audio") return <Waveform size={size} weight="bold" />;
  if (kind === "video") return <VideoCamera size={size} weight="fill" />;
  if (kind === "image" || kind === "logo") {
    return <ImageSquare size={size} weight="fill" />;
  }
  if (kind === "composition") return <Stack size={size} weight="fill" />;
  return <Cube size={size} weight="fill" />;
}

type TimelineClipContentVariant = "bar" | "media" | "audio";

interface TimelineClipContentProps {
  kind: TimelineKind;
  label: string;
  timecode?: string;
  variant?: TimelineClipContentVariant;
  leadingVisual?: ReactNode;
  body?: ReactNode;
}

export const TimelineClipContent = memo(function TimelineClipContent({
  kind,
  label,
  timecode,
  variant = "bar",
  leadingVisual,
  body,
}: TimelineClipContentProps) {
  return (
    <div className={`hf-timeline-clip-content is-${variant}`}>
      <div className="hf-timeline-clip-content__header">
        {leadingVisual ? (
          <span className="hf-timeline-clip-content__preview">{leadingVisual}</span>
        ) : (
          <span className="hf-timeline-clip-content__icon" aria-hidden="true">
            <TimelineKindIcon kind={kind} />
          </span>
        )}
        <span className="hf-timeline-clip-content__label">{label}</span>
        {timecode && <span className="hf-timeline-clip-content__timecode">{timecode}</span>}
      </div>
      {body && <div className="hf-timeline-clip-content__body">{body}</div>}
    </div>
  );
});
