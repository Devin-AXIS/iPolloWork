import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnimeJsAdapter } from "./animejs";

const animeWindow = window as Window & {
  anime?: {
    running: unknown[];
  };
  __hfAnime?: unknown[];
};

function createAnimeInstance(opts?: { duration?: number }) {
  return {
    seek: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    duration: opts?.duration ?? 2000,
  };
}

describe("animejs adapter", () => {
  beforeEach(() => {
    delete animeWindow.anime;
    delete animeWindow.__hfAnime;
  });

  afterEach(() => {
    delete animeWindow.anime;
    delete animeWindow.__hfAnime;
  });

  it("has correct name", () => {
    expect(createAnimeJsAdapter().name).toBe("animejs");
  });

  describe("discover", () => {
    it("auto-discovers from anime.running", () => {
      const instance = createAnimeInstance();
      animeWindow.anime = { running: [instance] };
      animeWindow.__hfAnime = [];
      const adapter = createAnimeJsAdapter();
      adapter.discover();
      expect(animeWindow.__hfAnime).toContain(instance);
    });

    it("does not duplicate existing instances", () => {
      const instance = createAnimeInstance();
      animeWindow.anime = { running: [instance] };
      animeWindow.__hfAnime = [instance];
      const adapter = createAnimeJsAdapter();
      adapter.discover();
      expect(animeWindow.__hfAnime).toHaveLength(1);
    });

    it("handles no global anime", () => {
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.discover()).not.toThrow();
    });

    it("handles empty running array", () => {
      animeWindow.anime = { running: [] };
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.discover()).not.toThrow();
    });
  });

  describe("seek", () => {
    it("seeks with time in milliseconds", () => {
      const instance = createAnimeInstance();
      animeWindow.__hfAnime = [instance];
      const adapter = createAnimeJsAdapter();
      adapter.seek({ time: 2 });
      expect(instance.seek).toHaveBeenCalledWith(2000);
    });

    it("seeks fractional seconds accurately", () => {
      const instance = createAnimeInstance();
      animeWindow.__hfAnime = [instance];
      const adapter = createAnimeJsAdapter();
      adapter.seek({ time: 0.5 });
      expect(instance.seek).toHaveBeenCalledWith(500);
    });

    it("clamps negative time to 0", () => {
      const instance = createAnimeInstance();
      animeWindow.__hfAnime = [instance];
      const adapter = createAnimeJsAdapter();
      adapter.seek({ time: -3 });
      expect(instance.seek).toHaveBeenCalledWith(0);
    });

    it("does nothing with no instances", () => {
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.seek({ time: 1 })).not.toThrow();
    });

    it("seeks multiple instances", () => {
      const a = createAnimeInstance();
      const b = createAnimeInstance();
      animeWindow.__hfAnime = [a, b];
      const adapter = createAnimeJsAdapter();
      adapter.seek({ time: 1.5 });
      expect(a.seek).toHaveBeenCalledWith(1500);
      expect(b.seek).toHaveBeenCalledWith(1500);
    });

    it("continues seeking remaining instances if one throws", () => {
      const bad = {
        seek: vi.fn(() => {
          throw new Error("boom");
        }),
        pause: vi.fn(),
        play: vi.fn(),
      };
      const good = createAnimeInstance();
      animeWindow.__hfAnime = [bad, good];
      const adapter = createAnimeJsAdapter();
      adapter.seek({ time: 1 });
      expect(good.seek).toHaveBeenCalledWith(1000);
    });
  });

  describe("pause", () => {
    it("pauses all instances", () => {
      const a = createAnimeInstance();
      const b = createAnimeInstance();
      animeWindow.__hfAnime = [a, b];
      const adapter = createAnimeJsAdapter();
      adapter.pause();
      expect(a.pause).toHaveBeenCalled();
      expect(b.pause).toHaveBeenCalled();
    });

    it("does nothing with no instances", () => {
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.pause()).not.toThrow();
    });
  });

  describe("play", () => {
    it("plays all instances", () => {
      const a = createAnimeInstance();
      animeWindow.__hfAnime = [a];
      const adapter = createAnimeJsAdapter();
      adapter.play!();
      expect(a.play).toHaveBeenCalled();
    });
  });

  describe("revert", () => {
    it("does not throw", () => {
      const adapter = createAnimeJsAdapter();
      expect(() => adapter.revert!()).not.toThrow();
    });
  });
});
