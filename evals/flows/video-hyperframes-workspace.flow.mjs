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
            await ctx.waitFor(`Boolean(
              document.querySelector('iframe[title*="HyperFrames"]')
              || [...document.querySelectorAll('button')].some((button) => /(?:Open Video Studio|打开视频工作台)/.test(button.title))
            )`, { timeoutMs: 30000, label: "Video Studio entry" });
            await ctx.eval(`(() => {
              if (document.querySelector('iframe[title*="HyperFrames"]')) return;
              [...document.querySelectorAll('button')]
                .find((button) => /(?:Open Video Studio|打开视频工作台)/.test(button.title))
                ?.click();
            })()`);
            await ctx.waitFor(`document.querySelector('iframe[title*="HyperFrames"]')?.dataset.loaded === "true"`, { timeoutMs: 60000, label: "loaded HyperFrames Studio" });
            await new Promise((resolve) => setTimeout(resolve, 1200));
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              iframe: Boolean(document.querySelector('iframe[title*="HyperFrames"]')),
              failed: document.body.innerText.includes('启动失败') || document.body.innerText.includes('failed to start'),
              designTab: [...document.querySelectorAll('[role="tab"]')].some((node) => node.textContent?.includes('Design')),
              htmlTab: [...document.querySelectorAll('[role="tab"]')].some((node) => node.textContent?.includes('HTML')),
            }))()`);
            ctx.assert(state.iframe && !state.failed && !state.designTab && !state.htmlTab, `Video is not a single Studio workspace: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "native-video-studio", rejectText: ["启动失败", "failed to start", "HTML source"] },
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
            const iframe = await ctx.eval(`document.querySelector('iframe[title*="HyperFrames"]')?.getAttribute('src') || ''`);
            ctx.assert(iframe.includes("#project/"), `Studio project route is wrong: ${iframe}`);
          },
        });
      },
    },
  ],
};
