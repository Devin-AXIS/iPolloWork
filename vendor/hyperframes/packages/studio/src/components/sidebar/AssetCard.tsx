/**
 * AssetCard and FontRow — visual asset tile / row components for the Assets panel.
 * Extracted from AssetsTab.tsx to keep that file under the 600-line CI gate.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { LocateFixed, Plus } from "lucide-react";
import { VideoFrameThumbnail } from "../ui/VideoFrameThumbnail";
import { VIDEO_EXT, IMAGE_EXT } from "../../utils/mediaTypes";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";
import { ContextMenu } from "./AssetContextMenu";
import { usePlayerStore } from "../../player/store/playerStore";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";
import { findClipForAsset, isPointerClick } from "../../utils/assetClickBehavior";
import { basename, ext, formatDuration } from "./assetHelpers";
import { resolveMediaPreviewUrl } from "../../player/components/thumbnailUtils";
import { useStudioI18n } from "../../i18n";

/** Drag payload writer shared by the asset tile and the font row: copy effect
 *  plus the timeline-asset MIME and a plain-text path fallback. */
function writeAssetDragData(e: React.DragEvent, asset: string): void {
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset }));
  e.dataTransfer.setData("text/plain", asset);
}

/** Open the row/tile context menu at the pointer, shared by asset tile + font row. */
function openAssetContextMenu(
  e: React.MouseEvent,
  setContextMenu: (menu: { x: number; y: number }) => void,
): void {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY });
}

/**
 * Lazily probe a video/audio URL for its duration via a hidden HTMLVideoElement
 * (`preload="metadata"`). The manifest only covers ~/.media assets, so project
 * assets in assets/ have no manifest entry — this fills the gap.
 * Returns `undefined` until the probe completes; `null` if it failed.
 */
function useProbedDuration(src: string, skip: boolean): number | null | undefined {
  const [duration, setDuration] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    setDuration(undefined);
    if (skip) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // The in-flight probe element, so unmount cleanup can abort its network
    // fetch (clearing `src`) instead of leaving it to finish in the background.
    let liveVid: HTMLVideoElement | null = null;

    function teardown(vid: HTMLVideoElement) {
      vid.onloadedmetadata = null;
      vid.onerror = null;
      vid.src = "";
    }

    function probe(attempt: number) {
      if (cancelled) return;
      const vid = document.createElement("video");
      liveVid = vid;
      vid.preload = "metadata";
      vid.muted = true;
      vid.onloadedmetadata = () => {
        const d = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : null;
        teardown(vid);
        if (!cancelled) setDuration(d);
      };
      vid.onerror = () => {
        teardown(vid);
        if (!cancelled) {
          if (attempt < 1) retryTimer = setTimeout(() => probe(attempt + 1), 50);
          else setDuration(null);
        }
      };
      vid.src = src;
    }

    probe(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (liveVid) teardown(liveVid);
    };
  }, [src, skip]);
  return duration;
}

export interface AssetCardProps {
  projectId: string;
  asset: string;
  used: boolean;
  duration?: number;
  onCopy: (path: string) => void;
  isCopied: boolean;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => void;
}

/**
 * Thumbnail card for images and video assets. Renders in a 2-col grid.
 *
 * Click opens preview for every image/video. A separate action reveals an
 * already-used clip on the timeline, and drag still inserts on the timeline.
 * Drag behaviour is preserved: a pointer movement exceeding DRAG_THRESHOLD_PX
 * before pointerup is treated as drag-start, not a click.
 */
// fallow-ignore-next-line complexity
export function AssetCard({
  projectId,
  asset,
  used,
  duration,
  onCopy,
  isCopied,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: AssetCardProps) {
  const { tx } = useStudioI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const fullName = asset.split("/").pop() ?? asset;
  const name = basename(asset);
  const extension = ext(asset);
  const serveUrl = resolveMediaPreviewUrl(asset, projectId);
  const isVideo = VIDEO_EXT.test(asset);
  const isImage = IMAGE_EXT.test(asset);
  const knownDuration = duration != null && Number.isFinite(duration) && duration > 0 ? duration : undefined;
  const probedDuration = useProbedDuration(serveUrl, !isVideo || knownDuration != null);
  const resolvedDuration = knownDuration ?? probedDuration ?? undefined;
  const durationLabel = formatDuration(resolvedDuration ?? 0);

  // Drag-threshold click gate: track pointer-down position so we can ignore
  // pointer-up events that followed a real drag gesture.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const requestClipReveal = usePlayerStore((s) => s.requestClipReveal);
  const elements = usePlayerStore((s) => s.elements);
  const setPreviewAsset = useAssetPreviewStore((s) => s.setPreviewAsset);
  const clearPreviewAsset = useAssetPreviewStore((s) => s.clearPreviewAsset);

  const openPreview = useCallback(() => {
    setPreviewAsset(asset, projectId);
  }, [asset, projectId, setPreviewAsset]);

  const locateOnTimeline = useCallback(() => {
    const clip = findClipForAsset(elements, asset);
    if (!clip) return;
    clearPreviewAsset();
    const clipKey = clip.key ?? clip.id;
    setSelectedElementId(clipKey);
    requestClipReveal(clipKey);
  }, [asset, clearPreviewAsset, elements, requestClipReveal, setSelectedElementId]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const origin = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!origin) return;
      if (!isPointerClick(e.clientX - origin.x, e.clientY - origin.y)) return;
      openPreview();
    },
    [openPreview],
  );

  return (
    <>
      <div
        data-testid="asset-card"
        data-asset-path={asset}
        draggable
        onDragStart={(e) => {
          pointerDownRef.current = null;
          writeAssetDragData(e, asset);
        }}
        onContextMenu={(e) => openAssetContextMenu(e, setContextMenu)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        className={`group/card relative flex min-w-0 cursor-pointer flex-col rounded-lg outline-none focus-within:ring-2 focus-within:ring-[#1FBAC0]/60 ${
          isCopied ? "rounded-lg ring-2 ring-studio-accent/30" : ""
        }`}
      >
        <button
          type="button"
          aria-label={`${tx("Preview")}: ${fullName}`}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { pointerDownRef.current = null; }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            openPreview();
          }}
          className="absolute inset-0 z-[1] rounded-lg focus-visible:outline-none"
        />
        {/* Thumbnail */}
        <div className="relative h-[100px] w-full overflow-hidden rounded-lg border border-panel-border bg-panel-input">
          {isImage && (
            <img
              src={serveUrl}
              alt={name}
              loading="lazy"
              className={`h-full w-full ${extension === "SVG" ? "object-contain p-4" : "object-cover"}`}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}
          {isVideo && (
            <>
              <VideoFrameThumbnail src={serveUrl} />
              {hovered && (
                <video
                  src={serveUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="pointer-events-none absolute inset-0 w-full h-full object-cover"
                />
              )}
            </>
          )}
          {!isImage && !isVideo && (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-[10px] font-medium text-neutral-600">{extension}</span>
            </div>
          )}

          {/* Usage and duration remain readable over the preview. */}
          {used && (
            <span className="pointer-events-none absolute right-2 top-2 z-[4] flex h-5 items-center gap-1 rounded-full bg-white/90 px-2 text-[10px] font-medium text-[#168e92] shadow-sm">
              <span aria-hidden="true">●</span>
              {tx("In use")}
            </span>
          )}
          {isVideo && (
            <span data-testid="asset-video-duration" className="pointer-events-none absolute bottom-2 left-2 z-[4] rounded bg-white/90 px-1.5 py-1 text-[10px] font-medium leading-none text-[#4d5159] shadow-sm tabular-nums">
              {durationLabel || "—"}
            </span>
          )}
          <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/65 via-transparent to-transparent opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100" />
          <div className="absolute bottom-2 right-2 z-[4] flex items-center gap-1 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100">
            {used && (
              <button
                type="button"
                data-testid="asset-locate-action"
                aria-label={tx("Locate on timeline")}
                title={tx("Locate on timeline")}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); locateOnTimeline(); }}
                className="flex size-7 items-center justify-center rounded-md bg-panel-input text-panel-text-1 shadow-sm hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/60"
              >
                <LocateFixed aria-hidden="true" size={16} strokeWidth={1.5} />
              </button>
            )}
            {onAddAssetToTimeline && (
              <button
                type="button"
                data-testid="asset-insert-action"
                aria-label={tx("Insert asset")}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onAddAssetToTimeline(asset); }}
                className="flex h-7 items-center gap-1 rounded-md bg-panel-input px-2 text-xs font-medium text-panel-text-1 shadow-sm hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/60"
              >
                <Plus aria-hidden="true" size={16} strokeWidth={1.5} />
                <span>{tx("Insert asset")}</span>
              </button>
            )}
          </div>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] rounded-[inherit] border-2 border-[#1FBAC0] opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100" />
        </div>

        {/* Filename caption */}
        <div className="flex w-full min-w-0 items-start justify-between gap-1 px-0.5 pt-[7px] leading-4">
          <span
            className="min-w-0 truncate text-xs font-medium text-panel-text-1"
            title={fullName}
          >
            {fullName}
          </span>
          <span className="flex-none text-[9px] uppercase text-panel-text-3">{extension}</span>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={asset}
          onClose={() => setContextMenu(null)}
          onCopy={onCopy}
          onDelete={onDelete}
          onRename={onRename}
          onAddAtPlayhead={onAddAssetToTimeline}
        />
      )}
    </>
  );
}

export interface FontRowProps {
  asset: string;
  used: boolean;
  onCopy: (path: string) => void;
  isCopied: boolean;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => void;
}

/**
 * Compact row for font assets (no meaningful thumbnail; show ext badge + name).
 */
export function FontRow({
  asset,
  used,
  onCopy,
  isCopied,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: FontRowProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const name = basename(asset);
  const extension = ext(asset);

  return (
    <>
      <div
        draggable
        onClick={() => onCopy(asset)}
        onDragStart={(e) => writeAssetDragData(e, asset)}
        onContextMenu={(e) => openAssetContextMenu(e, setContextMenu)}
        className={`px-2.5 py-1.5 flex items-center gap-2.5 cursor-pointer transition-colors ${
          isCopied
            ? "bg-studio-accent/10 border-l-2 border-studio-accent"
            : "border-l-2 border-transparent hover:bg-neutral-800/50"
        }`}
      >
        <div className="w-[50px] h-[32px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 flex items-center justify-center">
          <span className="text-[9px] font-medium text-neutral-700">{extension}</span>
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`text-xs font-medium truncate block ${used ? "text-panel-text-1" : "text-panel-text-3"}`}
          >
            {name}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-neutral-600 truncate">{extension}</span>
            {used && (
              <span className="text-[9px] font-medium text-panel-accent bg-panel-accent/10 px-1.5 py-px rounded">
                in use
              </span>
            )}
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={asset}
          onClose={() => setContextMenu(null)}
          onCopy={onCopy}
          onDelete={onDelete}
          onRename={onRename}
          onAddAtPlayhead={onAddAssetToTimeline}
        />
      )}
    </>
  );
}
