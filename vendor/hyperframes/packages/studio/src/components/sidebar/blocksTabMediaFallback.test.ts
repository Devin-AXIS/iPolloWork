import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./BlocksTab.tsx", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./blockPreviewRuntime.ts", import.meta.url), "utf8");

describe("BlocksTab lazy preview media", () => {
  it("keeps a broken poster lightweight until hover intent loads the runtime", () => {
    expect(source).toContain("setPosterFailed(true)");
    expect(source).toContain('import("./blockPreviewRuntime")');
    expect(source).toContain("setTimeout(startPreview, 150)");
    expect(source).toContain('alt=""');
    expect(runtime).toContain('document.createElement("video")');
  });

  it("keeps preview media pinned to the card bounds at normal speed", () => {
    expect(runtime).toContain('className = "absolute inset-0 size-full object-cover"');
    expect(runtime).toContain("video.defaultPlaybackRate = 1");
    expect(runtime).toContain("video.playbackRate = 1");
    expect(runtime).toContain('video.addEventListener("ratechange", normalizePlayback)');
  });
});
