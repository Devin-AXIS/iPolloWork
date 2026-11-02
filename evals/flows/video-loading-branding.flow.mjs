export default {
  id: "video-loading-branding",
  title: "Video loading uses a neutral progress indicator",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3912/" },
  steps: [{
    name: "Open the video preview while its runtime loads",
    run: async (ctx) => {
      await ctx.prove("Video loading shows a spinner and status without the HyperFrames logo or name", {
        voiceover: "视频加载时只显示转圈和加载提示，不再出现 HyperFrames 的标志或名称。",
        action: async () => {
          await ctx.client.send("Network.emulateNetworkConditionsByRule", {
            offline: false,
            matchedNetworkConditions: [{
              urlPattern: "*api/runtime.js",
              latency: 8_000,
              downloadThroughput: -1,
              uploadThroughput: -1,
            }],
          });
          await ctx.eval("location.reload(); true");
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"composition-loading-overlay\"] .hf-loader'))", {
            timeoutMs: 30_000,
            label: "native composition loading overlay",
          });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const overlay = document.querySelector('[data-testid="composition-loading-overlay"]');
            const indicator = overlay?.querySelector('[aria-hidden="true"]');
            const style = indicator && getComputedStyle(indicator);
            return {
              title: document.title,
              text: overlay?.innerText ?? '',
              logos: overlay?.querySelectorAll('svg,img').length,
              spinner: style?.animationName === 'spin' && indicator.getBoundingClientRect().width > 0,
              status: Boolean(overlay?.querySelector('[role="status"]')),
              favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? '',
            };
          })()`);
          ctx.assert(state.spinner && state.status, `Missing loading feedback: ${JSON.stringify(state)}`);
          ctx.assert(state.logos === 0 && !/hyperframes/i.test(state.title + state.text + state.favicon), `Branding remained: ${JSON.stringify(state)}`);
        },
        screenshot: {
          name: "video-loading-without-branding",
          requireText: ["Loading composition"],
          rejectText: ["HyperFrames"],
        },
      });
      await ctx.client.send("Network.emulateNetworkConditionsByRule", {
        offline: false,
        matchedNetworkConditions: [],
      });
      await ctx.waitFor("!document.querySelector('[data-testid=\"composition-loading-overlay\"]') && Boolean(document.querySelector('hyperframes-player'))", {
        timeoutMs: 30_000,
        label: "video canvas ready after releasing the test runtime delay",
      });
      ctx.log("The actual preview loaded normally after the isolated test network delay was released.");
    },
  }],
};
