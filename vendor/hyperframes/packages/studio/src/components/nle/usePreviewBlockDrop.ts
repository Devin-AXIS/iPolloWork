import { useCallback, useRef, useState, type RefObject } from "react";
import {
  fitTimelineAssetGeometry,
  TIMELINE_ASSET_MIME,
  TIMELINE_BLOCK_MIME,
} from "../../utils/timelineAssetDrop";

interface UsePreviewBlockDropOptions {
  portrait?: boolean;
  /**
   * Authored composition size measured from the live preview. Preferred over
   * the portrait fallback — hard-coding 1080/1920 places drops at the wrong
   * spot for any composition authored at another size (square, 720p, 4K).
   */
  compositionSize?: { width: number; height: number } | null;
  stageRef: RefObject<HTMLDivElement | null>;
  onBlockDrop?: (blockName: string, position: { left: number; top: number }) => void;
  onAssetDrop?: (assetPath: string) => void;
}

interface BlockDropPayload {
  name: string;
  dimensions?: { width: number; height: number };
}

function parseBlockPayload(raw: string): BlockDropPayload | null {
  try {
    const parsed = JSON.parse(raw) as {
      name?: string;
      dimensions?: { width: number; height: number };
    };
    return parsed.name ? (parsed as BlockDropPayload) : null;
  } catch {
    return null;
  }
}

export function parsePreviewAssetPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { path?: unknown };
    return typeof parsed.path === "string" && parsed.path.length > 0 ? parsed.path : null;
  } catch {
    return null;
  }
}

function supportsPreviewDrop(e: React.DragEvent, canDropBlock: boolean, canDropAsset: boolean) {
  return (
    (canDropBlock && e.dataTransfer.types.includes(TIMELINE_BLOCK_MIME)) ||
    (canDropAsset && e.dataTransfer.types.includes(TIMELINE_ASSET_MIME))
  );
}

function resolveCompositionPosition(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  compositionSize: { width: number; height: number } | null | undefined,
  portrait: boolean | undefined,
): { left: number; top: number } | null {
  if (stageRect.width === 0 || stageRect.height === 0) return null;

  const normalizedX = (clientX - stageRect.left) / stageRect.width;
  const normalizedY = (clientY - stageRect.top) / stageRect.height;

  const compWidth = compositionSize?.width ?? (portrait ? 1080 : 1920);
  const compHeight = compositionSize?.height ?? (portrait ? 1920 : 1080);

  return {
    left: Math.max(0, Math.min(normalizedX * compWidth, compWidth)),
    top: Math.max(0, Math.min(normalizedY * compHeight, compHeight)),
  };
}

function centerBlockAtPosition(
  pos: { left: number; top: number },
  block: BlockDropPayload,
  compositionSize: { width: number; height: number },
): { left: number; top: number } {
  const fitted = fitTimelineAssetGeometry(block.dimensions ?? null, compositionSize);
  return {
    left: Math.max(0, pos.left - fitted.width / 2),
    top: Math.max(0, pos.top - fitted.height / 2),
  };
}

export function usePreviewBlockDrop({
  portrait,
  compositionSize,
  stageRef,
  onBlockDrop,
  onAssetDrop,
}: UsePreviewBlockDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/dragleave fire for every internal element boundary; a depth
  // counter keeps the drop indicator steady instead of flickering.
  const dragDepthRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!supportsPreviewDrop(e, Boolean(onBlockDrop), Boolean(onAssetDrop))) return;
      dragDepthRef.current += 1;
      setIsDragOver(true);
    },
    [onAssetDrop, onBlockDrop],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!supportsPreviewDrop(e, Boolean(onBlockDrop), Boolean(onAssetDrop))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      // dragenter/dragleave own the isDragOver flag (depth-counted).
    },
    [onAssetDrop, onBlockDrop],
  );

  const handleDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  }, []);

  // fallow-ignore-next-line complexity
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      dragDepthRef.current = 0;
      setIsDragOver(false);

      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop) {
        const assetPath = parsePreviewAssetPayload(assetPayload);
        if (!assetPath) return;
        e.preventDefault();
        onAssetDrop(assetPath);
        return;
      }

      if (!onBlockDrop) return;

      const payload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (!payload) return;
      e.preventDefault();

      const block = parseBlockPayload(payload);
      const stage = stageRef.current;
      if (!block || !stage) return;

      const pos = resolveCompositionPosition(
        e.clientX,
        e.clientY,
        stage.getBoundingClientRect(),
        compositionSize,
        portrait,
      );
      if (!pos) return;

      const targetCompositionSize = compositionSize ?? {
        width: portrait ? 1080 : 1920,
        height: portrait ? 1920 : 1080,
      };
      onBlockDrop(block.name, centerBlockAtPosition(pos, block, targetCompositionSize));
    },
    [onAssetDrop, onBlockDrop, stageRef, compositionSize, portrait],
  );

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
