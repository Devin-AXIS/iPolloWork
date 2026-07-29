import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  BOOT_OVERLAY_FADE_MS,
  MIN_BOOT_OVERLAY_MS,
  remainingBootOverlayHoldMs,
} from "../src/react-app/shell/boot-overlay-timing";

const startupHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const loadingOverlay = readFileSync(
  new URL("../src/react-app/shell/loading-overlay.tsx", import.meta.url),
  "utf8",
);

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

  test("uses the branded animation on the application surface instead of a black startup frame", () => {
    expect(startupHtml).toContain("ipollowork-app-loading-v3.gif");
    expect(startupHtml).toContain("background: #fcfcfd");
    expect(startupHtml).not.toContain("background: #000000");
    expect(loadingOverlay).toContain('publicAssetUrl("ipollowork-app-loading-v3.gif")');
    expect(loadingOverlay).toContain("bg-dls-surface");
    expect(loadingOverlay).not.toContain("bg-black transition-opacity");
  });
});
