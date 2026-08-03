import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./BlocksTab.tsx", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../nle/PreviewOverlays.tsx", import.meta.url), "utf8");

describe("BlocksTab lazy preview media", () => {
  it("keeps a broken poster lightweight until hover intent loads the runtime", () => {
    expect(source).toContain("setPosterFailed(true)");
    expect(source).toContain("setTimeout(startPreview, 60)");
    expect(source).toContain("PREVIEW_CLEAR_DELAY_MS = 140");
    expect(source).toContain('alt=""');
    expect(source).toContain("No preview yet");
    expect(source).not.toContain('import("./blockPreviewRuntime")');
  });

  it("sends hover previews to the large preview overlay instead of playing inside cards", () => {
    expect(source).toContain("onPreview?.({ videoUrl, posterUrl, title: block.title })");
    expect(overlay).toContain("poster={blockPreview.posterUrl}");
    expect(overlay).toContain('preload="auto"');
    expect(overlay).toContain("src={blockPreview.videoUrl}");
    expect(overlay).toContain("onCanPlay={() => setVideoReady(true)}");
  });
});
