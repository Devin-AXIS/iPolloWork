import { describe, expect, test } from "bun:test";

import {
  DEFAULT_COSYVOICE_MODEL,
  MAX_VOICE_SAMPLE_BYTES,
  migrateVideoVoiceoverSettings,
  parseVideoVoiceoverSettings,
  serializeVideoVoiceoverSettings,
  synthesizedAudioUrl,
  validateVoiceSampleFile,
  videoVoiceoverSettingsPath,
  voiceSampleWorkspacePath,
} from "../src/react-app/domains/session/video/video-voice";

describe("video voiceover settings", () => {
  test("keeps the selected voice beside its session-owned video project", () => {
    expect(videoVoiceoverSettingsPath("ses/current video")).toBe("video/ses_current_video/voiceover.json");
    expect(voiceSampleWorkspacePath("ses/current video", "voice.m4a", 42)).toBe("video/ses_current_video/.voice-samples/42-m4a.m4a");
  });

  test("serializes only non-secret project voice data", () => {
    const content = serializeVideoVoiceoverSettings({
      provider: "aliyun-bailian",
      model: "cosyvoice-v3-flash",
      voiceId: "ipw-example",
      source: "cloned",
      updatedAt: "2026-07-15T10:00:00.000Z",
    });
    expect(parseVideoVoiceoverSettings(content)).toEqual({
      provider: "aliyun-bailian",
      model: "cosyvoice-v3-flash",
      voiceId: "ipw-example",
      source: "cloned",
      updatedAt: "2026-07-15T10:00:00.000Z",
    });
    expect(content).not.toContain("key");
    expect(content).not.toContain("url");
  });

  test("rejects malformed settings and unsupported clone samples", () => {
    expect(parseVideoVoiceoverSettings(JSON.stringify({ provider: "aliyun-bailian", voiceId: "missing-fields" }))).toBeNull();
    expect(validateVoiceSampleFile({ name: "voice.ogg", size: 100 })).toContain("WAV");
    expect(validateVoiceSampleFile({ name: "voice.wav", size: MAX_VOICE_SAMPLE_BYTES + 1 })).toContain("10 MB");
    expect(validateVoiceSampleFile({ name: "voice.mp3", size: 100 })).toBeNull();
  });

  test("upgrades only legacy preset voices that were paired with the v3 model", () => {
    const legacy = {
      provider: "aliyun-bailian" as const,
      model: DEFAULT_COSYVOICE_MODEL,
      voiceId: "longwan",
      source: "preset" as const,
      updatedAt: "2026-07-15T10:00:00.000Z",
    };
    expect(migrateVideoVoiceoverSettings(legacy)).toMatchObject({ voiceId: "longyingmu_v3" });
    const cloned = { ...legacy, source: "cloned" as const };
    expect(migrateVideoVoiceoverSettings(cloned)).toBe(cloned);
    expect(migrateVideoVoiceoverSettings({ ...legacy, model: "cosyvoice-v1" })).toMatchObject({ voiceId: "longwan" });
  });

  test("reads the current Model Studio audio URL while retaining the legacy response shape", () => {
    expect(synthesizedAudioUrl({
      output: { audio: { url: "https://audio.example.test/current.mp3" } },
    })).toBe("https://audio.example.test/current.mp3");
    expect(synthesizedAudioUrl({
      output: { audio_url: "https://audio.example.test/legacy.mp3" },
    })).toBe("https://audio.example.test/legacy.mp3");
    expect(synthesizedAudioUrl({ output: { audio: {} } })).toBe("");
  });
});
