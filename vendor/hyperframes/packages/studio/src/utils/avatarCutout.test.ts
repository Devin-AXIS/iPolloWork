// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { resolveAllVisualDomEditTargets } from "../components/editor/domEditingElement";
import { filterMaterialLibraryAssets } from "../components/sidebar/assetHelpers";
import { waitForAvatarPreviewReady } from "../hooks/useAvatarCutout";
import {
  applyAvatarCutout,
  avatarCutoutOutputPath,
  removeAvatarCutout,
  projectMediaPath,
  relativeMediaPath,
} from "./avatarCutout";

const html = `<!doctype html><div data-composition-id="main"><div id="bg" style="z-index:0"></div><video id="person" data-hf-id="p1" src="assets/person.mp4" data-track-index="1" data-start="2" data-duration="8" data-media-start="1" data-volume="0.8" style="position:absolute;left:20px;width:300px;z-index:9"></video><div id="title" data-track-index="2" style="z-index:4">标题</div></div><script>timeline.to('#person', {x: 40});</script>`;
const layers = [
  { target: { id: "person" }, zIndex: 1 },
  { target: { id: "title" }, zIndex: 2 },
];
const apply = () =>
  applyAvatarCutout(html, { hfId: "p1" }, "assets/person.mp4", "assets/cutout.webm", layers);
const parse = (value: string) => new DOMParser().parseFromString(value, "text/html");

describe("smart avatar cutout", () => {
  it("waits for the refreshed transparent foreground before finishing the operation", async () => {
    vi.useFakeTimers();
    try {
      const previousIframe = document.createElement("iframe");
      const refreshedIframe = document.createElement("iframe");
      document.body.append(previousIframe, refreshedIframe);
      const source = refreshedIframe.contentDocument!.createElement("video");
      source.id = "person";
      source.setAttribute("data-avatar-cutout", "person-avatar-foreground");
      const foreground = refreshedIframe.contentDocument!.createElement("video");
      foreground.id = "person-avatar-foreground";
      foreground.setAttribute("data-avatar-source", "person");
      refreshedIframe.contentDocument!.body.append(source, foreground);
      Object.defineProperty(foreground, "readyState", { configurable: true, value: 0 });

      const previewIframeRef = { current: previousIframe };
      const controller = new AbortController();
      const waiting = waitForAvatarPreviewReady({
        previewIframeRef,
        previousIframe,
        selection: { id: "person" },
        activeCompPath: null,
        removing: false,
        signal: controller.signal,
        timeoutMs: 1_000,
      });
      let settled = false;
      void waiting.then(() => {
        settled = true;
      });

      previewIframeRef.current = refreshedIframe;
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(false);

      Object.defineProperty(foreground, "readyState", { configurable: true, value: 2 });
      await vi.advanceTimersByTimeAsync(50);
      await expect(waiting).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = "";
    }
  });

  it("keeps right-click editing on the original avatar after adding its foreground", () => {
    document.body.innerHTML = apply();
    const source = document.querySelector<HTMLVideoElement>("#person")!;
    const foreground = document.querySelector<HTMLVideoElement>("[data-avatar-source]")!;
    for (const element of [source, foreground]) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 300, 500);
    }
    expect(
      resolveAllVisualDomEditTargets([foreground, source], { activeCompositionPath: "index.html" }),
    ).toEqual([source]);
    document.body.innerHTML = "";
  });
  it("keeps the source and its audio, creates one muted foreground, and preserves authored scripts", () => {
    const output = apply();
    const doc = parse(output);
    const source = doc.querySelector("#person")!;
    const foreground = doc.querySelector("[data-avatar-source]")!;
    expect(source.getAttribute("src")).toBe("assets/person.mp4");
    expect(source.getAttribute("data-volume")).toBe("0.8");
    expect(foreground.getAttribute("src")).toBe("assets/cutout.webm");
    expect(foreground.hasAttribute("muted")).toBe(true);
    expect(foreground.getAttribute("data-volume")).toBe("0");
    expect(foreground.hasAttribute("data-hf-id")).toBe(false);
    expect(foreground.getAttribute("data-start")).toBe("2");
    expect(foreground.getAttribute("data-media-start")).toBe("1");
    expect(source.getAttribute("data-track-index")).toBe("1");
    expect(foreground.getAttribute("data-track-index")).toBe("3");
    expect(output.endsWith("<script>timeline.to('#person', {x: 40});</script>")).toBe(true);
    expect(doc.querySelector<HTMLVideoElement>("#person")!.style.zIndex).toBe("1");
    expect(doc.querySelector<HTMLVideoElement>("[data-avatar-source]")!.style.zIndex).toBe("3");
  });
  it("does not duplicate completed cutouts and removes the foreground without deleting source media", () => {
    const output = apply();
    expect(
      applyAvatarCutout(output, { id: "person" }, "assets/person.mp4", "another.webm", layers),
    ).toBe(output);
    const restored = parse(removeAvatarCutout(output, { id: "person" }));
    expect(restored.querySelectorAll("video")).toHaveLength(1);
    expect(restored.querySelector<HTMLVideoElement>("video")!.style.zIndex).toBe("9");
    expect(restored.querySelector("video")!.hasAttribute("data-avatar-cutout")).toBe(false);
  });
  it("rejects stale or deleted targets before applying any changes", () => {
    expect(() =>
      applyAvatarCutout(html, { id: "person" }, "changed.mp4", "cutout.webm", layers),
    ).toThrow("变化");
    expect(() =>
      applyAvatarCutout(html, { id: "missing" }, "assets/person.mp4", "cutout.webm", layers),
    ).toThrow("找不到");
  });
  it("resolves project media relative to the selected composition", () => {
    expect(projectMediaPath("scenes/intro.html", "../assets/a%20b.mp4?v=2")).toBe("assets/a b.mp4");
    expect(relativeMediaPath("scenes/intro.html", "assets/a b-cutout.webm")).toBe(
      "../assets/a b-cutout.webm",
    );
    expect(() => projectMediaPath("index.html", "https://external.test/video.mp4")).toThrow("本地");
  });
  it("keeps cutout layers and avatar generation segments out of the material library", () => {
    expect(avatarCutoutOutputPath("assets/人物 01.mp4")).toBe(
      "renders/avatar-cutouts/01-cutout.webm",
    );
    expect(
      filterMaterialLibraryAssets([
        "assets/person.png",
        "assets/avatar-reference-job.png",
        "assets/avatar-voice-job.wav",
        "renders/avatar-job-0-0.mp4",
        "renders/avatar-job-0.wav",
        "renders/avatar-long-job.mp4",
        "renders/avatar-cutouts/avatar-long-job-cutout.webm",
      ]),
    ).toEqual(["assets/person.png", "renders/avatar-long-job.mp4"]);
    expect(
      filterMaterialLibraryAssets([
        "renders/avatar-long-job.mp4",
        "assets/avatar-long-job.webm",
      ]),
    ).toEqual(["assets/avatar-long-job.webm"]);
    expect(
      filterMaterialLibraryAssets(
        ["assets/person.mp4", "assets/cutouts/person-cutout.webm"],
        new Set(["assets/person.mp4"]),
      ),
    ).toEqual(["assets/person.mp4"]);
  });
});
