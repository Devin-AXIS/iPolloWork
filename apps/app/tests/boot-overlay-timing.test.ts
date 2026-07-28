import { describe, expect, test } from "bun:test";

import {
  BOOT_OVERLAY_FADE_MS,
  MIN_BOOT_OVERLAY_MS,
  remainingBootOverlayHoldMs,
} from "../src/react-app/shell/boot-overlay-timing";

describe("desktop boot overlay timing", () => {
  test("keeps the loading animation visible on a fast cold start", () => {
    expect(MIN_BOOT_OVERLAY_MS).toBeGreaterThanOrEqual(800);
    expect(remainingBootOverlayHoldMs(100)).toBe(MIN_BOOT_OVERLAY_MS - 100);
  });

  test("does not add delay after a slow boot and retains a fade", () => {
    expect(remainingBootOverlayHoldMs(MIN_BOOT_OVERLAY_MS + 1)).toBe(0);
    expect(remainingBootOverlayHoldMs(-10)).toBe(MIN_BOOT_OVERLAY_MS);
    expect(BOOT_OVERLAY_FADE_MS).toBeGreaterThan(0);
  });
});
