import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-hyperframes-workspace");

export default {
  id: "video-hyperframes-workspace",
  title: "Edit canvas elements inside the native HyperFrames Studio",
  kind: "user-facing",
  steps: [
    {
      name: "Video opens one native Studio workspace",
      run: async (ctx) => {
        await ctx.prove("Video keeps the HyperFrames canvas and timeline together", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label="Video"]:not([disabled])\'))', { timeoutMs: 30000, label: "Video rail button" });
            await ctx.eval(`(() => { const button = document.querySelector('button[aria-label="Video"]'); if (button?.getAttribute('aria-pressed') !== 'true') button?.click(); })()`);
            await ctx.waitForText("Studio ready", { timeoutMs: 60000 });
            await ctx.waitFor(`document.querySelector('iframe[title="HyperFrames Video Studio"]')?.dataset.loaded === "true"`, { timeoutMs: 30000, label: "loaded HyperFrames Studio" });
            await new Promise((resolve) => setTimeout(resolve, 1200));
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              iframe: Boolean(document.querySelector('iframe[title="HyperFrames Video Studio"]')),
              designTab: [...document.querySelectorAll('[role="tab"]')].some((node) => node.textContent?.includes('Design')),
              htmlTab: [...document.querySelectorAll('[role="tab"]')].some((node) => node.textContent?.includes('HTML')),
            }))()`);
            ctx.assert(state.iframe && !state.designTab && !state.htmlTab, `Video is not a single Studio workspace: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "native-video-studio", requireText: ["Video Studio"], rejectText: ["Design", "HTML source"] },
        });
      },
    },
    {
      name: "Studio is the inline editing surface",
      run: async (ctx) => {
        await ctx.prove("The native Studio owns canvas editing and timeline editing", {
          voiceover: vo[1],
          action: async () => {},
          assert: async () => {
            const iframe = await ctx.eval(`document.querySelector('iframe[title="HyperFrames Video Studio"]')?.getAttribute('src') || ''`);
            ctx.assert(iframe.includes("/#project/"), `Studio project route is wrong: ${iframe}`);
          },
        });
      },
    },
  ],
};
