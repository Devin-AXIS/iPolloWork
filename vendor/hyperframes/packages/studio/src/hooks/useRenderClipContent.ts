import { createElement, useCallback, type ReactNode } from "react";
import { CompositionThumbnail, VideoThumbnail, type TimelineElement } from "../player";
import { AudioWaveform } from "../player/components/AudioWaveform";
import { TimelineClipContent } from "../player/components/TimelineClipContent";
import {
  resolveTimelineClipLabel,
  resolveTimelineKind,
} from "../player/components/timelineLayerPresentation";
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
  const end = Math.max(start, Math.min(1, (mediaStart + element.duration * rate) / sourceDuration));
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
  activePreviewUrl: string | null;
}

export interface TimelineThumbnailPreview {
  previewUrl: string;
  selector: string;
  selectorIndex?: number;
  seekTime: number;
  duration: number;
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveTimelineElementSelector(element: TimelineElement): string | null {
  if (element.selector?.trim()) return element.selector;
  if (element.hfId?.trim()) {
    return `[data-hf-id="${escapeCssAttributeValue(element.hfId)}"]`;
  }
  if (element.domId?.trim()) {
    return `[id="${escapeCssAttributeValue(element.domId)}"]`;
  }
  return null;
}

/** Resolve the authored document and local time used for a timeline crop. */
export function resolveTimelineThumbnailPreview(
  element: TimelineElement,
  projectId: string,
  activePreviewUrl: string | null,
): TimelineThumbnailPreview | null {
  const selector = resolveTimelineElementSelector(element);
  if (!selector) return null;

  const sourceFile = element.sourceFile?.replace(/\\/g, "/");
  const previewUrl =
    sourceFile && sourceFile !== "index.html"
      ? `/api/projects/${projectId}/preview/comp/${encodePreviewPath(sourceFile)}`
      : (activePreviewUrl ?? `/api/projects/${projectId}/preview`);
  const seekTime = Math.max(0, element.start - (element.expandedParentStart ?? 0));

  return {
    previewUrl,
    selector,
    selectorIndex: element.selectorIndex,
    seekTime,
    duration: Math.max(0.01, element.duration),
  };
}

/**
 * Renders one compact visual owner per clip. Static authored layers use a
 * lazily captured crop, video uses a filmstrip, and audio owns a waveform.
 */
export function useRenderClipContent({
  projectIdRef,
  activePreviewUrl,
}: UseRenderClipContentOptions) {
  return useCallback(
    (element: TimelineElement, style: { clip: string; label: string }): ReactNode => {
      const projectId = projectIdRef.current;
      const kind = resolveTimelineKind(element);
      const label = resolveTimelineClipLabel(element);
      const timecode = formatTime(element.duration);

      if ((kind === "music" || kind === "voiceover" || kind === "audio") && projectId) {
        return createElement(TimelineClipContent, {
          label,
          timecode,
          variant: "audio",
          body: renderAudioClip(element, projectId, style.label),
        });
      }

      if (kind === "video" && element.src) {
        const videoSrc = projectId ? resolveMediaPreviewUrl(element.src, projectId) : element.src;
        return createElement(TimelineClipContent, {
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

      if (projectId) {
        const preview = resolveTimelineThumbnailPreview(element, projectId, activePreviewUrl);
        if (preview) {
          return createElement(TimelineClipContent, {
            label,
            timecode,
            variant: "media",
            body: createElement(CompositionThumbnail, {
              ...preview,
              label: "",
              labelColor: style.label,
              loading: "lazy",
              minLoadWidth: 52,
            }),
          });
        }
      }

      return createElement(TimelineClipContent, { label, variant: "bar" });
    },
    [activePreviewUrl, projectIdRef],
  );
}
