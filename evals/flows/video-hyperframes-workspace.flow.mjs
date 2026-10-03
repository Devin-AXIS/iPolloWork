import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-hyperframes-workspace");

export default {
  id: "video-hyperframes-workspace",
  title: "Edit canvas elements inside the native HyperFrames Studio",
  kind: "user-facing",
  steps: [
    {
      name: "First launch uses bundled video resources",
      run: async (ctx) => {
        await ctx.prove("Video Studio opens without downloading codecs", {
          voiceover: "Video Studio uses the codecs shipped with the desktop app; cloud resource availability cannot block first launch.",
          action: async () => {
            if (await ctx.eval(`location.hash.includes("/settings/")`)) await ctx.clickText("返回应用");
            const proofWorkspaceId = ctx.env.IPOLLOWORK_EVAL_VIDEO_WORKSPACE_ID?.trim();
            const proofSessionId = ctx.env.IPOLLOWORK_EVAL_VIDEO_SESSION_ID?.trim();
            if (proofWorkspaceId && proofSessionId) {
              await ctx.navigateHash(`/workspace/${proofWorkspaceId}/session/${proofSessionId}`);
              await ctx.waitFor(`Boolean(
                [...document.querySelectorAll('iframe[title*="HyperFrames"]')]
                  .some((iframe) => iframe.getClientRects().length > 0)
                || [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('index.html'))
              )`, { timeoutMs: 60_000, label: "configured video proof session" });
            }
            const hasStudioEntry = await ctx.eval(`Boolean(
              [...document.querySelectorAll('iframe[title*="HyperFrames"]')]
                .some((iframe) => iframe.getClientRects().length > 0)
              || [...document.querySelectorAll('[title="index.html"]')].some((node) => node.closest('button'))
              || [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('index.html'))
              || [...document.querySelectorAll('button')].some((button) => /(?:Open Video Studio|打开视频工作台)/.test(button.title))
            )`);
            if (!hasStudioEntry && !(proofWorkspaceId && proofSessionId)) {
              await ctx.clickText("视频", { selector: "button" });
            }
            await ctx.waitFor(`Boolean(
              [...document.querySelectorAll('iframe[title*="HyperFrames"]')]
                .some((iframe) => iframe.getClientRects().length > 0)
              || [...document.querySelectorAll('[title="index.html"]')].some((node) => node.closest('button'))
              || [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('index.html'))
              || [...document.querySelectorAll('button')].some((button) => /(?:Open Video Studio|打开视频工作台)/.test(button.title))
            )`, { timeoutMs: 30_000, label: "Video Studio entry" });
            await ctx.eval(`(() => {
              if ([...document.querySelectorAll('iframe[title*="HyperFrames"]')]
                .some((iframe) => iframe.getClientRects().length > 0)) return;
              const openButton = [...document.querySelectorAll('button')]
                .find((button) => /(?:Open Video Studio|打开视频工作台)/.test(button.title))
                || [...document.querySelectorAll('[title="index.html"]')]
                  .map((node) => node.closest('button'))
                  .find(Boolean)
                || [...document.querySelectorAll('button')]
                  .find((button) => button.textContent?.includes('index.html'));
              openButton?.click();
            })()`);
            await ctx.waitFor(`document.querySelector('iframe[title*="HyperFrames"]')?.dataset.loaded === "true"`, {
              timeoutMs: 30_000,
              label: "Studio loaded from bundled resources",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              loaded: document.querySelector('iframe[title*="HyperFrames"]')?.dataset.loaded === 'true',
              failed: /Cloud resource manifest|启动失败/.test(document.body.innerText),
            }))()`);
            ctx.assert(state.loaded && !state.failed, `Bundled Studio did not load: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "video-first-launch-bundled-resources",
            rejectText: ["视频资源下载失败", "Cloud resource manifest", "启动失败"],
          },
        });
      },
    },
    {
      name: "Video opens one native Studio workspace",
      run: async (ctx) => {
        await ctx.prove("Video keeps the HyperFrames canvas and timeline together", {
          voiceover: vo[1],
          action: async () => {
            await ctx.waitFor(`Boolean(
              [...document.querySelectorAll('iframe[title*="HyperFrames"]')]
                .some((iframe) => iframe.getClientRects().length > 0)
              || document.querySelector('[data-testid="video-resource-download-progress"]')
              || [...document.querySelectorAll('button')].some((button) => /(?:Open Video Studio|打开视频工作台)/.test(button.title))
            )`, { timeoutMs: 30000, label: "Video Studio startup" });
            await ctx.eval(`(() => {
              if ([...document.querySelectorAll('iframe[title*="HyperFrames"]')]
                .some((iframe) => iframe.getClientRects().length > 0)) return;
              [...document.querySelectorAll('button')]
                .find((button) => /(?:Open Video Studio|打开视频工作台)/.test(button.title))
                ?.click();
            })()`);
            await ctx.waitFor(`document.querySelector('iframe[title*="HyperFrames"]')?.dataset.loaded === "true"`, { timeoutMs: 720000, label: "loaded HyperFrames Studio" });
            await new Promise((resolve) => setTimeout(resolve, 1200));
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              iframe: [...document.querySelectorAll('iframe[title*="HyperFrames"]')]
                .some((iframe) => iframe.getClientRects().length > 0),
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
          voiceover: vo[2],
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
