import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const studioSource = readFileSync(
  new URL("../../../vendor/hyperframes/packages/studio/src/components/sidebar/BlocksTab.tsx", import.meta.url),
  "utf8",
);
const videoPanelSource = readFileSync(
  new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
  "utf8",
);
const surfaceSource = readFileSync(
  new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
  "utf8",
);
const voicePanelSource = readFileSync(
  new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
  "utf8",
);
const englishLocaleSource = readFileSync(new URL("../src/i18n/locales/en.ts", import.meta.url), "utf8");
const chineseLocaleSource = readFileSync(new URL("../src/i18n/locales/zh.ts", import.meta.url), "utf8");

describe("Video Studio animation reference handoff", () => {
  test("Ask AI sends a structured animation reference instead of opening a prompt modal", () => {
    expect(studioSource).toContain('type: "ipollowork:hyperframes:animation-reference"');
    expect(studioSource).toContain("agentPrompt: prompt");
    expect(studioSource).not.toContain("PromptPreviewModal");
  });

  test("the host turns the Studio reference into a hidden composer animation tag", () => {
    expect(videoPanelSource).toContain('event.data?.type !== "ipollowork:hyperframes:animation-reference"');
    expect(videoPanelSource).toContain('"ipollowork:add-animation-reference"');
    expect(surfaceSource).toContain('window.addEventListener("ipollowork:add-animation-reference"');
    expect(surfaceSource).toContain("item.agentPrompt");
    expect(surfaceSource).toContain("animation.item.title");
  });

  test("the animation reference uses the selected-element chip treatment and confirms the handoff", () => {
    expect(surfaceSource).toContain('data-composer-token="animation-reference"');
    expect(surfaceSource).toContain("border-violet-6/35 bg-violet-3/20");
    expect(surfaceSource).toContain('toast.success(t("new_conversation.animations.added_to_ai"))');
  });

  test("both voice tabs hand the selected voice to the same AI composer flow", () => {
    expect(voicePanelSource.match(/<VoiceAiButton/g)).toHaveLength(2);
    expect(voicePanelSource).toContain('new CustomEvent("ipollowork:add-voice-reference"');
    expect(voicePanelSource).toContain('t("video.voice.ai_action")');
    expect(surfaceSource).toContain('data-composer-token="voice-reference"');
    expect(surfaceSource).toContain('const DEFAULT_VOICEOVER_PROMPT = "请用这段话给我视频做配音"');
    expect(surfaceSource).toContain('toast.success(t("new_conversation.animations.added_to_ai"))');
  });

  test("localizes the complete voice panel instead of rendering Chinese copy in English", () => {
    expect(voicePanelSource).not.toMatch(/[\u3400-\u9fff]/);
    expect(voicePanelSource).toContain('t("video.voice.preset_tab")');
    expect(voicePanelSource).toContain('t("video.voice.my_voices_tab")');
    expect(voicePanelSource).toContain('t("video.voice.official_presets")');
    expect(voicePanelSource).toContain('t("video.voice.choose_official")');
    expect(englishLocaleSource).toContain('"video.voice.preset_tab": "Preset voices"');
    expect(englishLocaleSource).toContain('"video.voice.my_voices_tab": "My voices"');
    expect(englishLocaleSource).toContain('"video.voice.ai_action": "Ask AI"');
    expect(englishLocaleSource).toContain('"video.voice.preset_name.longanyang": "Long Anyang"');
    expect(chineseLocaleSource).toContain('"video.voice.preset_tab": "百炼音色"');
    expect(chineseLocaleSource).toContain('"video.voice.my_voices_tab": "我的声音"');
  });
});
