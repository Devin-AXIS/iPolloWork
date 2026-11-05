import { afterEach, expect, it, vi } from "vitest";
import {
  observeAvatarCutoutLayers,
  syncAvatarCutoutLayers,
  refreshRuntimeMediaCache,
} from "./media";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("keeps the foreground aligned, timed, muted, and above content without z-index growth", () => {
  document.body.innerHTML =
    '<div><video id="source" data-avatar-cutout="fg" data-start="3" data-duration="5" data-media-start="2" style="position:absolute;left:34px;width:200px;transform:translateX(40px);z-index:1"></video><section style="z-index:8"><div class="scene-fill"></div><h1>Title</h1></section><video id="fg" data-avatar-source="source" src="cutout.webm"></video></div>';
  const source = document.querySelector<HTMLVideoElement>("#source")!;
  const fg = document.querySelector<HTMLVideoElement>("#fg")!;
  const fill = document.querySelector<HTMLElement>(".scene-fill")!;
  vi.spyOn(source, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 10, 40, 80));
  vi.spyOn(fill, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
  source.defaultPlaybackRate = 1.5;
  syncAvatarCutoutLayers();
  syncAvatarCutoutLayers();
  expect(fg.style.left).toBe("34px");
  expect(fg.style.transform).toBe("translateX(40px)");
  expect(fg.style.zIndex).toBe("9");
  expect(fg.muted).toBe(true);
  expect(decodeURIComponent(fill.style.maskImage)).toContain(
    'x="2000" y="1000" width="4000" height="8000"',
  );
  expect(document.querySelector<HTMLElement>("h1")!.style.maskImage).toBe("");
  const clips = refreshRuntimeMediaCache().videoClips;
  expect(clips.map((c) => [c.start, c.duration, c.mediaStart, c.playbackRate])).toEqual([
    [3, 5, 2, 1.5],
    [3, 5, 2, 1.5],
  ]);
  source.style.visibility = "hidden";
  source.dataset.duration = "2";
  syncAvatarCutoutLayers();
  expect(fg.style.visibility).toBe("hidden");
  expect(fg.dataset.duration).toBe("2");
});

it("hides orphan foregrounds after source deletion", () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  document.body.innerHTML = '<video id="fg" data-avatar-source="deleted"></video>';
  syncAvatarCutoutLayers();
  expect(document.querySelector<HTMLVideoElement>("video")!.style.display).toBe("none");
});

it("keeps the foreground attached during a live source edit", async () => {
  document.body.innerHTML =
    '<div><video id="source" data-avatar-cutout="fg" style="position:absolute;left:10px;top:20px;width:200px;height:300px"></video><video id="fg" data-avatar-source="source"></video></div>';
  const source = document.querySelector<HTMLVideoElement>("#source")!;
  const foreground = document.querySelector<HTMLVideoElement>("#fg")!;
  const stop = observeAvatarCutoutLayers();

  source.style.left = "48px";
  source.style.top = "72px";
  source.style.width = "240px";
  source.style.height = "360px";
  source.style.rotate = "12deg";
  await Promise.resolve();
  await Promise.resolve();

  expect(foreground.style.left).toBe("48px");
  expect(foreground.style.top).toBe("72px");
  expect(foreground.style.width).toBe("240px");
  expect(foreground.style.height).toBe("360px");
  expect(foreground.style.rotate).toBe("12deg");
  stop();
});

it("retries a foreground once when a generated asset was cached before it finished", () => {
  document.body.innerHTML =
    '<div><video id="source" data-avatar-cutout="fg"></video><video id="fg" data-avatar-source="source" src="assets/cutout.webm"></video></div>';
  const foreground = document.querySelector<HTMLVideoElement>("#fg")!;
  Object.defineProperty(foreground, "error", {
    configurable: true,
    value: { code: 4, message: "DEMUXER_ERROR_COULD_NOT_OPEN" },
  });
  const load = vi.spyOn(foreground, "load").mockImplementation(() => {});

  syncAvatarCutoutLayers();
  syncAvatarCutoutLayers();

  expect(foreground.src).toContain("assets/cutout.webm?_hfAvatarRetry=1");
  expect(load).toHaveBeenCalledOnce();
});
