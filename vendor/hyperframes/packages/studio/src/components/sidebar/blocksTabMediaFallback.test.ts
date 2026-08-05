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
    expect(source).not.toContain("No preview yet");
    expect(source).not.toContain('import("./blockPreviewRuntime")');
  });

  it("sends hover previews to the large preview overlay instead of playing inside cards", () => {
    expect(source).toContain("compositionUrl: compositionPlaybackUrl");
    expect(overlay).toContain("poster={blockPreview.posterUrl}");
    expect(overlay).toContain('preload="auto"');
    expect(overlay).toContain("src={blockPreview.videoUrl}");
    expect(overlay).toContain("onCanPlay={() => setVideoReady(true)}");
  });

  it("reuses registry compositions when catalog media is missing or fails", () => {
    expect(source).toContain("/api/registry/blocks/${encodeURIComponent(block.name)}/preview");
    expect(source).toContain("compositionPosterUrl");
    expect(source).toContain('sandbox="allow-scripts"');
    expect(source).toContain("canShowVideoThumbnail");
    expect(source).toContain("setVideoThumbnailFailed(true)");
    expect(source).toContain('rootMargin: "240px 0px"');
    expect(source).toContain('contentVisibility: "auto"');
    expect(source).not.toContain("setThumbnailEnabled(true)");
    expect(source).toContain("const BlockCard = memo(function BlockCard");
    expect(source).toContain("onAddBlock={onAddBlock}");
    expect(overlay).toContain("blockPreview.compositionUrl");
    expect(overlay).toContain("setVideoFailed(true)");
    expect(overlay).toContain('sandbox="allow-scripts"');
  });
});
