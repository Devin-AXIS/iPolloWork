import { afterEach, describe, expect, it, vi } from "vitest";
import { ParentMediaManager } from "./parent-media";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("edited voiceover playback", () => {
  it.each([false, true])("adopts timed voiceovers regardless of stale scene metadata: %s", (withMetadata) => {
    const audio = document.createElement("audio");
    audio.id = "vo-narration";
    audio.src = "http://localhost/narration.mp3";
    audio.preload = "auto";
    audio.dataset.start = "2";
    audio.dataset.duration = "3";
    if (withMetadata) {
      audio.dataset.ipwVoiceover = "true";
      audio.dataset.ipwSceneId = "scene-before-edit";
      audio.dataset.ipwSceneText = "Previous scene text";
      audio.dataset.ipwNarrationText = "Edited narration";
    }
    document.body.append(audio);
    const manager = new ParentMediaManager({
      dispatchEvent: vi.fn(), getMuted: () => false, getVolume: () => 0.7,
      getPlaybackRate: () => 1, getCurrentTime: () => 2.5, isPaused: () => true,
    });
    try {
      manager.setupFromIframe(document);
      expect(manager.entries).toHaveLength(1);
      expect(manager.entries[0].el.muted).toBe(false);
      expect(manager.entries[0].el.volume).toBe(0.7);
      expect(manager.entries[0].start).toBe(2);
      expect(manager.entries[0].duration).toBe(3);
      manager.updateMuted(true);
      expect(manager.entries[0].el.muted).toBe(true);
      manager.updateMuted(false);
      expect(manager.entries[0].el.muted).toBe(false);
    } finally {
      manager.destroy();
    }
  });
});
