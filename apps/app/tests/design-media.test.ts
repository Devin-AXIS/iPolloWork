import { describe, expect, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relativeDesignMediaPath, resolveDesignMediaPath, resolveDesignPreviewAssetPath, designMediaTools } from "../src/react-app/domains/session/design/design-media";
import { buildDesignPreviewDocument } from "../src/react-app/domains/session/design/design-html-runtime";
import { mediaKindForPath, parseVideoImageRequest, safeVideoMediaPath, VIDEO_IMAGE_OPEN } from "@ipollowork/types/video-image-workbench";

describe("Design authored media contract", () => {
  test("the minified production runtime remains a valid standalone iframe script", async () => {
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../src/react-app/domains/session/design/design-html-runtime.ts", import.meta.url))],
      target: "browser", format: "esm", minify: true,
    });
    expect(result.success).toBe(true);
    const temporary = await mkdtemp(join(tmpdir(), "ipollowork-minified-runtime-"));
    const modulePath = join(temporary, "runtime.mjs");
    await writeFile(modulePath, await result.outputs[0].text());
    let module;
    try { module = await import(pathToFileURL(modulePath).href); }
    finally { await rm(temporary, { recursive: true, force: true }); }
    const html = module.buildDesignPreviewDocument('<html><body><video src="clip.mp4"></video></body></html>', true);
    const script = html.match(/<script id="ipollowork-design-runtime">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script)).not.toThrow();
  });
  test.each(["svg", "gif", "avif"])("preserves read-only %s previews without advertising model editing", extension => {
    const src = `assets/original.${extension}`;
    expect(resolveDesignPreviewAssetPath("design/one/index.html", src)).toBe(`design/one/${src}`);
    expect(resolveDesignMediaPath("design/one/index.html", src)).toBeNull();
  });
  test.each(["https://host/a.png", "file:///a.mp4", "//host/a.png", "../../../a.png", "C:/a.png", "assets/a.png?x", "assets/a.svg", "assets/a%252e.png", "assets/a%5cb.png"])("rejects unsafe or unsupported sources: %s", src => {
    expect(resolveDesignMediaPath("design/one/index.html", src)).toBeNull();
  });
  test("resolves nested and Unicode paths without changing workspace ownership", () => {
    expect(resolveDesignPreviewAssetPath("design/one/index.html", "assets/photo.gif?v=2#frame")).toBe("design/one/assets/photo.gif");
    expect(resolveDesignMediaPath("design/one/pages/index.html", "../assets/背景.png")).toBe("design/one/assets/背景.png");
    expect(resolveDesignMediaPath("design/one/index.html", "assets/%E8%83%8C%E6%99%AF.mp4")).toBe("design/one/assets/背景.mp4");
    expect(relativeDesignMediaPath("design/one/pages/index.html", "artifacts/edit.mov")).toBe("../../../artifacts/edit.mov");
  });
  test("shares one self-contained media implementation with the isolated runtime", () => {
    const runtime = buildDesignPreviewDocument("<html><body></body></html>", true);
    expect(runtime).toContain(designMediaTools.toString());
    expect(runtime).toContain('data.type === "media-fill"');
    expect(runtime).toContain("mediaTools.restore");
    expect(runtime).toContain("media: mediaTools.read(element)");
    expect(runtime).toContain("video:not([data-ipw-media-background])");
    const script = runtime.match(/<script id="ipollowork-design-runtime">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });
  test("webm follows the shared editable video-media contract", () => {
    expect(resolveDesignMediaPath("design/one/index.html", "assets/original.webm")).toBe("design/one/assets/original.webm");
    expect(mediaKindForPath("assets/original.webm")).toBe("video");
  });
  test("protocol binds video extensions to a video request, never an image request", () => {
    const request = { type: VIDEO_IMAGE_OPEN, requestId: "10000000-0000-4000-8000-000000000001", projectId: "one", sourcePath: "assets/clip.mp4", kind: "video" };
    expect(parseVideoImageRequest(request)?.kind).toBe("video");
    expect(parseVideoImageRequest({ ...request, kind: "image" })).toBeNull();
    expect(safeVideoMediaPath("../clip.mp4")).toBeNull();
    expect(mediaKindForPath("clip.MOV")).toBe("video");
  });
});
