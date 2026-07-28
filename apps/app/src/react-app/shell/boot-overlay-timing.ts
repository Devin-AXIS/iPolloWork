export const MIN_BOOT_OVERLAY_MS = 900;
export const BOOT_OVERLAY_FADE_MS = 160;

export function remainingBootOverlayHoldMs(elapsedMs: number): number {
  return Math.max(0, MIN_BOOT_OVERLAY_MS - Math.max(0, elapsedMs));
}
