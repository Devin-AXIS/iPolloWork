import { describe, expect, it } from "vitest";

import { parseAudioElements } from "./audioMixer.js";

describe("parseAudioElements", () => {
  it("uses an authored data-duration without requiring a media probe", () => {
    const [track] = parseAudioElements(
      '<audio id="voiceover" src="assets/voiceover.mp3" data-start="11.05" data-duration="15.312"></audio>',
    );

    expect(track).toMatchObject({ id: "voiceover", start: 11.05 });
    expect(track?.end).toBeCloseTo(26.362);
  });

  it("keeps supporting an absolute data-end when duration is absent", () => {
    const [track] = parseAudioElements(
      '<audio id="music" src="assets/music.mp3" data-start="2" data-end="8"></audio>',
    );

    expect(track).toMatchObject({
      id: "music",
      start: 2,
      end: 8,
    });
  });
});
