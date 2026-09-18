import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { t } from "../src/i18n";
import zh from "../src/i18n/locales/zh";
import en from "../src/i18n/locales/en";

import {
  DEFAULT_COSYVOICE_MODEL,
  defaultVideoVoiceoverSettings,
  BAILIAN_PRESET_VOICES,
  BAILIAN_PRESET_GROUPS,
  MAX_VOICE_SAMPLE_BYTES,
  migrateVideoVoiceoverSettings,
  parseVideoVoiceDisplayMetadata,
  parseVideoVoiceoverSettings,
  serializeVideoVoiceoverSettings,
  synthesizedAudioUrl,
  validateVoiceSampleFile,
  videoVoiceDisplayMetadata,
  videoVoiceoverSettingsPath,
  videoVoiceoverAvailability,
  voiceSampleWorkspacePath,
  type VideoVoiceoverSettings,
} from "../src/react-app/domains/session/video/video-voice";

describe("video voiceover settings", () => {
  test("defaults to voiceover only when the sound provider is configured", () => {
    const available = { ok: true, result: { output: { configured: true } } };
    const unavailable = { ok: true, result: { output: { configured: false } } };
    const optedOut = serializeVideoVoiceoverSettings({
      ...defaultVideoVoiceoverSettings("2026-09-14T00:00:00.000Z"),
      enabled: false,
    });
    expect(videoVoiceoverAvailability(unavailable, null)).toEqual({ configured: false, enabled: false });
    expect(videoVoiceoverAvailability(available, null)).toEqual({ configured: true, enabled: true });
    expect(videoVoiceoverAvailability(available, optedOut)).toEqual({ configured: true, enabled: false });
  });

  test("every curated preset has translated labels and survives project persistence unchanged", () => {
    expect(new Set(BAILIAN_PRESET_VOICES.map(voice => voice.id)).size).toBe(BAILIAN_PRESET_VOICES.length);
    for (const voice of BAILIAN_PRESET_VOICES) {
      expect(BAILIAN_PRESET_GROUPS).toContain(voice.group);
      for (const locale of [zh, en]) {
        for (const key of [`video.voice.preset_name.${voice.id}`, `video.voice.preset_description.${voice.id}`, `video.voice.preset_group.${voice.group}`]) {
          expect(Reflect.get(locale, key)).toBeTruthy();
        }
      }
      const settings: VideoVoiceoverSettings = { ...defaultVideoVoiceoverSettings("2026-09-14T00:00:00.000Z"), voiceId: voice.id, selectionMode: "manual" };
      expect(parseVideoVoiceoverSettings(serializeVideoVoiceoverSettings(settings))).toEqual(settings);
      expect(migrateVideoVoiceoverSettings(settings)).toEqual(settings);
    }
  });

  test("keeps the selected voice beside its session-owned video project", () => {
    expect(videoVoiceoverSettingsPath("ses/current video")).toBe("video/ses_current_video/voiceover.json");
    expect(voiceSampleWorkspacePath("ses/current video", "voice.m4a", 42)).toBe("video/ses_current_video/.voice-samples/42-m4a.m4a");
  });

  test("serializes only non-secret project voice data", () => {
    const settings: VideoVoiceoverSettings = {
      ...defaultVideoVoiceoverSettings("2026-07-15T10:00:00.000Z"),
      voiceId: "ipw-example",
      source: "cloned",
      selectionMode: "manual",
      rate: 1.15,
      pitch: 0.95,
      volume: 62,
      instruction: "请用温暖亲切的表达方式说。",
    };
    const content = serializeVideoVoiceoverSettings(settings);
    expect(parseVideoVoiceoverSettings(content)).toEqual(settings);
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

  test("round-trips the voice reference displayed in the AI conversation", () => {
    const reference = { voiceId: "longanyang", model: DEFAULT_COSYVOICE_MODEL, label: "配音 · 龙安阳", rate: 1.1, pitch: 0.95, volume: 58, instruction: "请用温暖亲切的表达方式说。" };
    const metadata = videoVoiceDisplayMetadata(reference);

    expect(parseVideoVoiceDisplayMetadata(`Capability context\n${metadata}\nVoice instructions`)).toEqual(reference);
    expect(parseVideoVoiceDisplayMetadata("Selected video voiceover reference:")).toBeNull();
  });

  test("localizes the embedded voice authorization prompt", () => {
    expect(t("video.voice.configure_title", { lng: "en" })).toBe("Connect a voice service to enable voiceover");
    expect(t("video.voice.configure_description", { lng: "en" })).toBe(
      "Save your Alibaba Model Studio API key in Authorization Center to select and preview voices.",
    );
    expect(t("video.voice.configure_title", { lng: "zh" })).toBe("连接声音服务，开启配音");

    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(panelSource).toContain('t("video.voice.configure_title")');
    expect(panelSource).toContain('t("video.voice.configure_description")');
  });
});
