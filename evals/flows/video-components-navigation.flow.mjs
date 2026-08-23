import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-components-navigation");
const EXPECTED_TABS = ["图层", "主题", "组件", "动画", "配音", "素材"];

export default {
  id: "video-components-navigation",
  title: "Video Studio exposes one focused component workflow",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3387" },
  preserveTheme: true,
  steps: [
    {
      name: "The focused Video Studio navigation is complete",
      run: async (ctx) => {
        await ctx.prove("Video Studio presents one focused set of creation tools", {
          voiceover: vo[0],
          action: async () => {
            const inspectorOpen = await ctx.eval(
              'Boolean(document.querySelector("button[aria-label=\\"组件\\"]"))',
            );
            if (!inspectorOpen) {
              await ctx.trustedClick('button[aria-label="属性"]');
            }
            await ctx.trustedClick('button[aria-label="组件"]');
            await ctx.waitFor(
              "Boolean(document.querySelector('[data-testid=\"block-catalog-search\"]'))",
              { label: "component catalog" },
            );
          },
          assert: async () => {
            const labels = await ctx.eval(`[
              ...document.querySelectorAll('.hf-inspector-tabs-scroll button[aria-label]')
            ].map((button) => button.getAttribute('aria-label'))`);
            ctx.assert(
              JSON.stringify(labels) === JSON.stringify(EXPECTED_TABS),
              `Unexpected Video Studio tabs: ${JSON.stringify(labels)}`,
            );
            await ctx.expectText("全部组件 · 29");
            await ctx.expectText("Brand Headline");
            await ctx.expectText("产品 · 1");
            await ctx.expectText("数据 · 9");
            await ctx.expectText("地图 · 8");
            await ctx.expectText("结尾 · 1");
          },
          screenshot: {
            name: "focused-video-navigation",
            // Electron's GPU surface intermittently hangs this CDP method;
            // capture the actual browser view instead of the compositor surface.
            fromSurface: false,
            requireText: [...EXPECTED_TABS, "全部组件 · 29", "Brand Headline", "产品 · 1", "数据 · 9", "地图 · 8", "结尾 · 1"],
          },
        });
      },
    },
  ],
};
