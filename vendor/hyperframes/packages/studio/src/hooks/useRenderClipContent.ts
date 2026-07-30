import { createElement, useCallback, type ReactNode } from "react";
import { VideoThumbnail, type TimelineElement } from "../player";
import { AudioWaveform } from "../player/components/AudioWaveform";
import { ImageThumbnail } from "../player/components/ImageThumbnail";
import { TimelineClipContent } from "../player/components/TimelineClipContent";
import { resolveTimelineKind } from "../player/components/timelineLayerPresentation";
import { encodePreviewPath, resolveMediaPreviewUrl } from "../player/components/thumbnailUtils";
import { formatTime } from "../player/lib/time";

export function normalizeCompositionSrc(
  compSrc: string,
  projectId: string,
  origin: string,
): string {
  try {
    const parsed = new URL(compSrc, origin);
    const previewPrefix = `/api/projects/${projectId}/preview/`;
    if (parsed.pathname.startsWith(previewPrefix)) {
      return parsed.pathname.slice(previewPrefix.length);
    }
  } catch {
    // Already relative.
  }
  return compSrc;
}

function resolvePreviewRelative(src: string | undefined, projectId: string): string | null {
  if (!src) return null;
  if (!src.startsWith("http")) return src;
  const base = `/api/projects/${projectId}/preview/`;
  const index = src.indexOf(base);
  return index !== -1 ? decodeURIComponent(src.slice(index + base.length)) : null;
}

function trimFractions(element: TimelineElement): { start?: number; end?: number } {
  const sourceDuration = element.sourceDuration;
  if (sourceDuration == null || sourceDuration <= 0) return {};
  const mediaStart = element.playbackStart ?? 0;
  const rate = element.playbackRate ?? 1;
  const start = Math.max(0, Math.min(1, mediaStart / sourceDuration));
  const end = Math.max(
    start,
    Math.min(1, (mediaStart + element.duration * rate) / sourceDuration),
  );
  return { start, end };
}

function renderAudioClip(
  element: TimelineElement,
  projectId: string,
  labelColor: string,
): ReactNode {
  const relativeSource = resolvePreviewRelative(element.src, projectId);
  const encodedSource = relativeSource ? encodePreviewPath(relativeSource) : null;
  const audioUrl = encodedSource
    ? `/api/projects/${projectId}/preview/${encodedSource}`
    : (element.src ?? "");
  const waveformUrl = encodedSource
    ? `/api/projects/${projectId}/waveform/${encodedSource}`
    : undefined;
  const { start, end } = trimFractions(element);
  return createElement(AudioWaveform, {
    audioUrl,
    waveformUrl,
    label: "",
    labelColor,
    trimStartFraction: start,
    trimEndFraction: end,
  });
}

interface UseRenderClipContentOptions {
  projectIdRef: { current: string | null };
  compIdToSrc: Map<string, string>;
  activePreviewUrl: string | null;
  effectiveTimelineDuration: number;
}

/**
 * Renders one compact visual owner per clip. Static layers use an icon/bar,
 * video alone uses a filmstrip, and audio alone owns a waveform. Avoiding
 * per-element composition captures prevents duplicate preview renders.
 */
export function useRenderClipContent({ projectIdRef }: UseRenderClipContentOptions) {
  return useCallback(
    (element: TimelineElement, style: { clip: string; label: string }): ReactNode => {
      const projectId = projectIdRef.current;
      const kind = resolveTimelineKind(element);
      const label = element.label?.trim() || element.domId?.trim() || element.id;
      const timecode = formatTime(element.duration);

      if ((kind === "music" || kind === "voiceover" || kind === "audio") && projectId) {
        return createElement(TimelineClipContent, {
          kind,
          label,
          timecode,
          variant: "audio",
          body: renderAudioClip(element, projectId, style.label),
        });
      }

      if ((kind === "image" || kind === "logo") && element.src) {
        const imageSrc = projectId
          ? resolveMediaPreviewUrl(element.src, projectId)
          : element.src;
        return createElement(TimelineClipContent, {
          kind,
          label,
          variant: "bar",
          leadingVisual: createElement(ImageThumbnail, {
            imageSrc,
          }),
        });
      }

      if (kind === "video" && element.src) {
        const videoSrc = projectId
          ? resolveMediaPreviewUrl(element.src, projectId)
          : element.src;
        return createElement(TimelineClipContent, {
          kind,
          label,
          timecode,
          variant: "media",
          body: createElement(VideoThumbnail, {
            videoSrc,
            label: "",
            labelColor: style.label,
            duration: element.duration,
          }),
        });
      }

      return createElement(TimelineClipContent, { kind, label, variant: "bar" });
    },
    [projectIdRef],
  );
}
