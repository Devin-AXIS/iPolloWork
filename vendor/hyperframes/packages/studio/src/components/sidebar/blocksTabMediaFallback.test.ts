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
    expect(source).not.toContain("if (!visible || reducedMotion) return;");
    expect(source).toContain("src={compositionPlaybackUrl}");
    expect(source).toContain("onLoad={() => setPreviewReady(true)}");
    expect(source).not.toContain("aria-label={`${block.title} preview`}");
    expect(source).not.toContain("autoPlay");
    expect(source).not.toContain("onPreviewBlock");
  });

  it("reuses real registry compositions for every hover preview and missing catalog media", () => {
    expect(source).toContain("/api/registry/blocks/${encodeURIComponent(block.name)}/preview");
    expect(source).toContain("compositionPosterUrl");
    expect(source).toContain('sandbox="allow-scripts"');
    expect(source).toContain("canShowVideoThumbnail");
    expect(source).toContain("setVideoThumbnailFailed(true)");
    expect(source).toContain('rootMargin: "240px 0px"');
    expect(source).toContain('contentVisibility: "auto"');
    expect(source).not.toContain("setThumbnailEnabled(true)");
    expect(source).not.toContain("visible &&\n    !block.visualComponent");
    expect(source).toContain("const BlockCard = memo(function BlockCard");
    expect(source).toContain("onAddBlock={onAddBlock}");
    expect(source).toContain("setVideoThumbnailFailed(true)");
  });

  it("prefers focused composition previews for caption animation components", () => {
    expect(source).toContain('block.type === "hyperframes:component"');
    expect(source).toContain('block.librarySection === "caption-animation"');
    expect(source).toContain("const prefersCompositionPreview");
    expect(source).toContain("!prefersCompositionPreview && Boolean(posterUrl)");
    expect(source).toMatch(/!prefersCompositionPreview\s+&&\s+Boolean\(videoUrl\)/);
    expect(source).toContain("prefersCompositionPreview ||");
  });

  it("names the catalog action as a component insert", () => {
    expect(source).toContain('"插入组件"');
    expect(source).toContain('"Insert component"');
    expect(source).toContain('"在当前播放位置插入组件，并将后续片段顺延"');
    expect(source).not.toContain('"插入动画"');
    expect(source).not.toContain('"添加组件"');
    expect(source).not.toContain('"Add component"');
  });

  it("locks every catalog insertion entry while one component is inserting", () => {
    expect(source).toContain("const insertingBlockNameRef = useRef<string | null>(null)");
    expect(source).toContain("if (!onAddBlock || insertingBlockNameRef.current) return false");
    expect(source).toContain("const insertionBusy = insertingBlockName !== null");
    expect(source).toContain("disabled={insertionBusy}");
    expect(source.match(/^\s+disabled=\{insertionBusy\}/gm)).toHaveLength(2);
    expect(source).toContain("draggable={!insertionBusy}");
    expect(source).toContain("aria-disabled={insertionBusy}");
    expect(source).not.toContain("const [adding, setAdding] = useState(false)");
  });
});
