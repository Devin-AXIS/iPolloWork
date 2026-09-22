import { useCallback } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";

/** Drops an asset onto track 0, allowing host-owned assets to resolve a canonical start. */
export function useAddAssetAtPlayhead(
  handleTimelineAssetDrop: (
    assetPath: string,
    placement: Pick<TimelineElement, "start" | "track">,
    durationOverride?: number,
  ) => unknown,
  resolvePlacement?: (assetPath: string, currentTime: number) => number | { start: number; duration?: number } | Promise<number | { start: number; duration?: number }>,
) {
  return useCallback(
    (assetPath: string): void => {
      const currentTime = usePlayerStore.getState().currentTime;
      void Promise.resolve(resolvePlacement?.(assetPath, currentTime) ?? currentTime).then((placement) => {
        const start = typeof placement === "number" ? placement : placement.start;
        const duration = typeof placement === "number" ? undefined : placement.duration;
        return handleTimelineAssetDrop(assetPath, { start, track: 0 }, duration);
      });
    },
    [handleTimelineAssetDrop, resolvePlacement],
  );
}
