import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRegistryPreviewFromRoot } from "../helpers/registryPreview";
import { buildRegistryPreviewHtml } from "./registry";

const SOURCE = "<!doctype html><html><body><main>Preview</main></body></html>";

describe("buildRegistryPreviewHtml", () => {
  it("seeks a fitted registry composition to a representative card frame", () => {
    const html = buildRegistryPreviewHtml(SOURCE, {
      assetBaseUrl: "/api/registry/blocks/example/assets/",
      autoplay: false,
      duration: 6,
      seekTime: 2,
      width: 1920,
      height: 1080,
    });

    expect(html).toContain("data-hf-registry-preview");
    expect(html).toContain('<base href="/api/registry/blocks/example/assets/">');
    expect(html).toContain("const autoplay = false");
    expect(html).toContain("const seekTime = 2");
    expect(html).toContain("const sourceWidth = 1920");
    expect(html).toContain('window.dispatchEvent(new CustomEvent("hf-seek"');
    expect(html.indexOf("data-hf-registry-preview")).toBeLessThan(html.indexOf("</body>"));
  });

  it("loops the live hover preview and clamps unsafe timing values", () => {
    const html = buildRegistryPreviewHtml(SOURCE, {
      assetBaseUrl: "/api/registry/blocks/example/assets/",
      autoplay: true,
      duration: 0,
      seekTime: 99,
      width: 0,
      height: 0,
    });

    expect(html).toContain("const autoplay = true");
    expect(html).toContain("const duration = 0.1");
    expect(html).toContain("const seekTime = 0.1");
    expect(html).toContain("const sourceWidth = 1");
    expect(html).toContain("const motionDuration = timelineDurations.length");
    expect(html).toContain("motionDuration + 0.45");
    expect(html).toContain("% previewDuration");
    expect(html).toContain("requestAnimationFrame(tick)");
  });

  it("zooms the card preview around a caption focus point", () => {
    const html = buildRegistryPreviewHtml(SOURCE, {
      assetBaseUrl: "/api/registry/blocks/example/assets/",
      autoplay: false,
      duration: 6,
      seekTime: 2,
      width: 1920,
      height: 1080,
      focus: { x: 0.5, y: 0.78, zoom: 2.35 },
    });

    expect(html).toContain('"x":0.5');
    expect(html).toContain("baseScale * previewFocus.zoom");
    expect(html).toContain("previewFocus ? previewFocus.y : 0.5");
  });

  it("marks caption-animation component previews for focused card rendering", () => {
    const registryRoot = mkdtempSync(join(tmpdir(), "hf-caption-preview-"));
    const itemRoot = join(registryRoot, "components", "caption-sample");
    mkdirSync(itemRoot, { recursive: true });
    writeFileSync(
      join(itemRoot, "registry-item.json"),
      JSON.stringify({
        name: "caption-sample",
        type: "hyperframes:component",
        title: "Caption Sample",
        description: "Caption sample",
        librarySection: "caption-animation",
        files: [{ path: "caption-sample.html", target: "x.html", type: "hyperframes:snippet" }],
      }),
    );
    writeFileSync(
      join(itemRoot, "demo.html"),
      '<main data-width="1920" data-height="1080" data-duration="8">Caption demo</main>',
    );

    const preview = loadRegistryPreviewFromRoot(registryRoot, "caption-sample");

    expect(preview?.focus).toEqual({ x: 0.5, y: 0.78, zoom: 2.35 });
  });

  it("promotes a standalone registry template so its composition and scripts render", () => {
    const html = buildRegistryPreviewHtml(
      '<!doctype html><html><body><template id="demo"><div data-composition-id="demo">Visible</div><script>window.demoLoaded = true</script></template></body></html>',
      {
        assetBaseUrl: "/api/registry/blocks/example/assets/",
        autoplay: false,
        duration: 6,
        seekTime: 2,
        width: 1920,
        height: 1080,
      },
    );

    expect(html).not.toContain('<template id="demo">');
    expect(html).toContain('<div data-composition-id="demo">Visible</div>');
    expect(html).toContain("window.demoLoaded = true");
  });
});
