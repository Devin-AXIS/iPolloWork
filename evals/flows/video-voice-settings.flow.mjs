import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-voice-settings");

async function openVideoStudio(ctx) {
  await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label="Video"]:not([disabled])\'))', { timeoutMs: 30_000, label: "Video rail button" });
  await ctx.eval(`(() => {
    const button = document.querySelector('button[aria-label="Video"]');
    if (button?.getAttribute('aria-pressed') !== 'true') button?.click();
    if (document.querySelector('[data-testid="video-voice-panel"]')) document.querySelector('button[aria-label="打开配音设置"]')?.click();
  })()`);
  await ctx.waitForText("Studio ready", { timeoutMs: 60_000 });
}

export default {
  id: "video-voice-settings",
  title: "Video Studio exposes a session-scoped Bailian voice configuration",
  kind: "user-facing",
  steps: [
    {
      name: "Sound and Preview share the Studio toolbar",
      run: async (ctx) => {
        await ctx.prove("Video Studio keeps sound settings and Preview beside each other", {
          voiceover: vo[0],
          action: async () => {
            await openVideoStudio(ctx);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              frame: Boolean(document.querySelector('iframe[title="HyperFrames Video Studio"]')),
              sound: Boolean(document.querySelector('button[aria-label="打开配音设置"]')),
              preview: Boolean(document.querySelector('button[aria-label="试听当前配音"]')),
            }))()`);
            ctx.assert(state.frame && state.sound && state.preview, `Video toolbar is incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "video-toolbar-sound-preview", requireText: ["Video Studio", "Preview"] },
        });
      },
    },
    {
      name: "Voice settings stay in the Video Studio side configuration",
      run: async (ctx) => {
        await ctx.prove("The sound control opens a compact Bailian voice configuration without replacing the timeline", {
          voiceover: vo[1],
          action: async () => {
            await ctx.trustedClick('[aria-label="打开配音设置"]');
            await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="video-voice-panel"]\'))', { timeoutMs: 20_000, label: "voice configuration panel" });
            await ctx.waitFor('!document.body.innerText.includes("正在读取百炼配置…")', { timeoutMs: 30_000, label: "voice configuration status" });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              voicePanel: Boolean(document.querySelector('[data-testid="video-voice-panel"]')),
              studioFrame: Boolean(document.querySelector('iframe[title="HyperFrames Video Studio"]')),
              hasBailianLabel: document.body.innerText.includes('阿里百炼'),
            }))()`);
            ctx.assert(state.voicePanel && state.studioFrame && state.hasBailianLabel, `Voice configuration state is wrong: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "video-voice-configuration", requireText: ["配音", "阿里百炼"], rejectText: ["HTML source"] },
        });
      },
    },
  ],
};
