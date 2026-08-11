import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./BlocksTab.tsx", import.meta.url), "utf8");

describe("BlocksTab lazy preview media", () => {
  it("keeps a broken poster lightweight until hover intent loads the runtime", () => {
    expect(source).toContain("setPosterFailed(true)");
    expect(source).toContain("setTimeout(startPreview, 60)");
    expect(source).toContain('alt=""');
    expect(source).not.toContain("No preview yet");
    expect(source).not.toContain('import("./blockPreviewRuntime")');
  });

  it("plays one hover preview inside its own card without taking over the canvas", () => {
    expect(source).toContain("previewController.start(block.name");
    expect(source).toContain("setPreviewing(true)");
    expect(source).toContain("src={compositionPlaybackUrl}");
    expect(source).toContain("onCanPlay={() => setPreviewReady(true)}");
    expect(source).not.toContain("onPreviewBlock");
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
    expect(source).toContain("setVideoThumbnailFailed(true)");
  });
});
