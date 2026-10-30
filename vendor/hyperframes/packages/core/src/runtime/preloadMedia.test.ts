import { describe, expect, it, vi } from "vitest";
import { preloadMedia, releaseMedia, deferMediaUntilDue } from "./preloadMedia";

function media(tagName = "VIDEO", networkState = 2, readyState = 0) {
  return { tagName, networkState, readyState, preload: "metadata", load: vi.fn() };
}

describe("initial media preload", () => {
  it("defers past and future clips while preserving media at the restored playhead", async () => {
    const originalUrl = window.location.href;
    window.history.replaceState({}, "", "?__hf_preview_time=45");
    const preview = document.createElement("style");
    preview.setAttribute("data-hf-skip-hidden-images", "");
    document.head.append(preview);
    const clips = document.createElement("div");
    try {
      deferMediaUntilDue();
      clips.innerHTML = '<video id="past" data-start="0" data-duration="10"></video>'
        + '<video id="current" data-start="40" data-duration="10"></video>'
        + '<video id="future" data-start="60" data-duration="10"></video>';
      document.body.append(clips);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(clips.querySelector<HTMLVideoElement>("#past")?.preload).toBe("none");
      expect(clips.querySelector<HTMLVideoElement>("#future")?.preload).toBe("none");
      expect(clips.querySelector<HTMLVideoElement>("#current")?.preload).not.toBe("none");
    } finally {
      clips.remove();
      preview.remove();
      deferMediaUntilDue();
      window.history.replaceState({}, "", originalUrl);
    }
  });

  it.each([0, 1, 2])(
    "keeps an active video fetch at readyState %s while enabling eager preload",
    (readyState) => {
      const video = media("VIDEO", 2, readyState);
      preloadMedia(video);
      expect(video.preload).toBe("auto");
      expect(video.load).not.toHaveBeenCalled();
    },
  );
  it.each([0, 1, 3])("starts or retries incomplete video at networkState %s", (networkState) => {
    const video = media("VIDEO", networkState);
    preloadMedia(video);
    expect(video.preload).toBe("auto");
    expect(video.load).toHaveBeenCalledOnce();
  });
  it("preserves audio loading while a streaming source is still being fetched", () => {
    const audio = media("AUDIO");
    preloadMedia(audio);
    expect(audio.preload).toBe("auto");
    expect(audio.load).toHaveBeenCalledOnce();
  });
  it.each(["VIDEO", "AUDIO"])("does not reset ready %s media", (tagName) => {
    const element = media(tagName, 1, 3);
    preloadMedia(element);
    expect(element.preload).toBe("auto");
    expect(element.load).not.toHaveBeenCalled();
  });
});

describe("releasing a clip's download", () => {
  it("reloads a src clip with its src dropped, then puts the src back", () => {
    const video = document.createElement("video");
    video.setAttribute("src", "a.mp4");
    const atLoad: (string | null)[] = [];
    video.load = () => atLoad.push(video.getAttribute("src"));

    releaseMedia(video);
    expect(atLoad).toEqual([null]);
    expect(video.getAttribute("src")).toBe("a.mp4");
  });

  it("leaves a clip on <source> children, their order and its markup untouched", () => {
    const video = document.createElement("video");
    video.innerHTML =
      '\n  <track kind="captions">\n  <source src="b.webm">\n  <source src="b.mp4">\n';
    const markup = video.innerHTML;
    video.load = vi.fn();

    releaseMedia(video);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.innerHTML).toBe(markup);
  });
});
