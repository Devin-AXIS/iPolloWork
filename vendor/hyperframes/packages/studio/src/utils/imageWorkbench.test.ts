// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import {
  captureVideoImageBinding,
  replaceBoundVideoImage,
  resolveEditableVideoImage,
  uploadedVideoImagePath,
} from "./imageWorkbench";
import {
  MAX_VIDEO_IMAGE_BYTES,
  VIDEO_IMAGE_APPLY,
  VIDEO_IMAGE_OPEN,
  parseVideoImageApply,
  parseVideoImageRequest,
  safeVideoImagePath,
} from "@ipollowork/types/video-image-workbench";

const root = "http://localhost:5192/api/projects/proof/preview/";
function selection(html: string, sourceFile = "index.html"): DomEditSelection {
  document.body.innerHTML = html;
  const element = document.querySelector<HTMLElement>("[data-hf-id]");
  if (!element) throw new Error("Missing test element");
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return {
    element,
    hfId: element.dataset.hfId,
    label: "Test image",
    tagName: element.tagName.toLowerCase(),
    sourceFile,
    compositionPath: sourceFile,
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: { "background-image": style?.backgroundImage ?? "none" },
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}
beforeEach(() => {
  document.head.innerHTML = "";
  window.location.href = root + "index.html";
});

describe("video image workbench binding", () => {
  it("normalizes Windows upload paths without allowing traversal or absolute paths", () => {
    expect(uploadedVideoImagePath({ files: ["assets\\edited.png"] })).toBe("assets/edited.png");
    expect(uploadedVideoImagePath({ files: ["assets/edited.png"] })).toBe("assets/edited.png");
    for (const path of ["..\\outside.png", "C:\\outside.png", "\\\\server\\a.png", "assets\\..\\a.png", {}, null]) {
      expect(uploadedVideoImagePath({ files: [path] })).toBeNull();
    }
    expect(uploadedVideoImagePath({ files: [] })).toBeNull();
  });
  it("uses the real preview base element instead of the extensionless preview endpoint", () => {
    window.location.href = root.slice(0, -1) + "?_hfRefresh=1";
    document.head.innerHTML = `<base href="${root}">`;
    expect(
      resolveEditableVideoImage(
        selection('<img data-hf-id="one" src="assets/source.png">'),
        "proof",
      )?.sourcePath,
    ).toBe("assets/source.png");
  });
  it("resolves an authored local image and replaces only its reference, retaining timing, style and scripts", () => {
    const html =
      '<img data-hf-id="one" src="assets/source.png" data-start="2" data-duration="4" style="width:120px;transform:rotate(5deg)"><img data-hf-id="two" src="assets/source.png"><script>animate("one")</script>';
    const selected = selection(html);
    const image = resolveEditableVideoImage(selected, "proof");
    expect(image?.sourcePath).toBe("assets/source.png");
    if (!image) throw new Error("No image");
    const next = replaceBoundVideoImage(
      html,
      captureVideoImageBinding(selected, image, html),
      "assets/source-edited.png",
    );
    expect(next).toBe(html.replace('src="assets/source.png"', 'src="assets/source-edited.png"'));
  });
  it("updates a selected CSS background including its theme token without changing the layout", () => {
    const html = `<div class="scene clip" data-hf-id="one" data-start="0" style="width:500px;background-image:url('assets/source.png');--ipw-bg-image:url('assets/source.png')"></div>`;
    const selected = selection(html);
    const image = resolveEditableVideoImage(selected, "proof");
    expect(image?.kind).toBe("background");
    if (!image) throw new Error("No image");
    const next = replaceBoundVideoImage(
      html,
      captureVideoImageBinding(selected, image, html),
      "assets/source-edited.png",
    );
    expect(
      new DOMParser().parseFromString(next, "text/html").querySelector("div")?.style.width,
    ).toBe("500px");
    expect(next).toContain('data-start="0"');
    expect(next.match(/assets\/source-edited.png/g)).toHaveLength(2);
    expect(next).not.toContain("assets/source.png");
  });
  it("resolves nested composition paths and emits the correct relative reference", () => {
    window.location.href = root + "scenes/one.html";
    const html = '<img data-hf-id="one" src="../assets/背景.png">';
    const selected = selection(html, "scenes/one.html");
    const image = resolveEditableVideoImage(selected, "proof");
    expect(image?.sourcePath).toBe("assets/背景.png");
    if (!image) throw new Error("No image");
    expect(
      replaceBoundVideoImage(
        html,
        captureVideoImageBinding(selected, image, html),
        "assets/背景-edited.png",
      ),
    ).toContain('src="../assets/背景-edited.png"');
  });
  it.each([
    '<video data-hf-id="one" poster="assets/source.png"></video>',
    '<video><img data-hf-id="one" src="assets/source.png"></video>',
    '<canvas data-hf-id="one" style="background-image:url(assets/source.png)"></canvas>',
    '<img data-hf-id="one" src="https://example.org/image.png">',
    '<img data-hf-id="one" src="data:image/png;base64,AAAA">',
    '<img data-hf-id="one" src="assets/source.svg">',
    '<picture><img data-hf-id="one" src="assets/source.png"></picture>',
    '<img data-hf-id="one" src="assets/source.png" srcset="assets/other.png 2x">',
    '<div data-hf-id="one" style="background-image:url(assets/a.png),url(assets/b.png)"></div>',
    '<img data-hf-id="one" src="../../outside.png">',
    '<img data-hf-id="one" src="assets/%252e%252e/outside.png">',
  ])("does not expose an editor for unsupported or unbound media: %s", (html) => {
    expect(resolveEditableVideoImage(selection(html), "proof")).toBeNull();
  });
  it("fails closed when the target was deleted or its original reference changed", () => {
    const html = '<img data-hf-id="one" src="assets/source.png">';
    const selected = selection(html);
    const image = resolveEditableVideoImage(selected, "proof");
    if (!image) throw new Error("No image");
    const binding = captureVideoImageBinding(selected, image, html);
    expect(() => replaceBoundVideoImage("", binding, "assets/new.png")).toThrow("changed");
    expect(() =>
      replaceBoundVideoImage(html.replace("source.png", "other.png"), binding, "assets/new.png"),
    ).toThrow("changed");
  });
  it.each([
    '<video data-hf-id="one" src="assets/background.mp4" poster="assets/poster.png" data-start="3" data-duration="4" style="width:500px"></video>',
    '<video data-hf-id="one" data-start="3" data-duration="4" style="width:500px"><source src="assets/background.mp4" type="video/mp4"></video>',
  ])("opens authored videos as whole clips and preserves timing/layout: %s", html => {
    const selected = selection(html);
    const media = resolveEditableVideoImage(selected, "proof");
    expect(media?.kind).toBe("video");
    expect(media?.sourcePath).toBe("assets/background.mp4");
    if (!media) throw new Error("Missing video");
    const binding = captureVideoImageBinding(selected, media, html);
    const result = replaceBoundVideoImage(html, binding, "assets/edited.mov");
    const video = new DOMParser().parseFromString(result, "text/html").querySelector("video");
    expect(video?.getAttribute("src")).toBe("assets/edited.mov");
    expect(video?.getAttribute("data-start")).toBe("3");
    expect(video?.getAttribute("data-duration")).toBe("4");
    expect(video?.style.width).toBe("500px");
    expect(() => replaceBoundVideoImage(html, binding, "assets/edited.png")).toThrow();
    expect(() => replaceBoundVideoImage(html.replace("background.mp4", "other.mp4"), binding, "assets/edited.mp4")).toThrow();
  });
  it("rejects ambiguous video sources and media kind mismatches", () => {
    expect(resolveEditableVideoImage(selection('<video data-hf-id="one"><source src="assets/a.mp4"><source src="assets/b.mp4"></video>'), "proof")).toBeNull();
    expect(resolveEditableVideoImage(selection('<video data-hf-id="one" src="assets/a.png"></video>'), "proof")).toBeNull();
    expect(resolveEditableVideoImage(selection('<img data-hf-id="one" src="assets/a.mp4">'), "proof")).toBeNull();
  });
});

describe("image bridge input boundary", () => {
  const requestId = "10000000-0000-4000-8000-000000000001";
  it.each([
    "../a.png",
    "/a.png",
    "C:/a.png",
    "a\\b.png",
    "a/%2e%2e/b.png",
    "a.png?x",
    "a/./b.png",
    "a//b.png",
    'a\".png',
    "a.svg",
  ])("rejects invalid workspace paths: %s", (path) => expect(safeVideoImagePath(path)).toBeNull());
  it("requires a valid selection request and a bounded copy", () => {
    expect(
      parseVideoImageRequest({
        type: VIDEO_IMAGE_OPEN,
        requestId,
        projectId: "proof",
        sourcePath: "assets/a.png",
      }),
    ).not.toBeNull();
    const action = {
      type: VIDEO_IMAGE_APPLY,
      requestId,
      actionId: requestId,
      mode: "copy",
      image: { bytes: new ArrayBuffer(1), name: "edited.png" },
    };
    expect(parseVideoImageApply(action)).not.toBeNull();
    expect(parseVideoImageApply({ ...action, actionId: "../outside" })).toBeNull();
    expect(
      parseVideoImageApply({
        ...action,
        image: { ...action.image, bytes: new ArrayBuffer(MAX_VIDEO_IMAGE_BYTES + 1) },
      }),
    ).toBeNull();
    expect(
      parseVideoImageApply({ ...action, image: { ...action.image, name: "../edited.png" } }),
    ).toBeNull();
  });
});
