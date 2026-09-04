import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-components-navigation");
const EXPECTED_ENGLISH_TABS = ["Layers", "Style", "Components", "Animation", "Voice", "Assets"];
const EXPECTED_CHINESE_TABS = ["图层", "主题", "组件", "动画", "配音", "素材"];
const EXPECTED_ENGLISH_CATEGORIES = [
  "All components · 84",
  "Openers & Endings · 4",
  "Product Showcase · 3",
  "Data & Charts · 15",
  "Flows & Diagrams · 5",
  "Maps & Routes · 12",
  "Comparison & Proof · 5",
  "Knowledge · 2",
  "People & Quotes · 2",
  "Text & Labels · 4",
  "Media & UI · 5",
  "Social Media · 19",
  "Code Demos · 3",
  "Brand & Marketing · 5",
];
const EXPECTED_CHINESE_CATEGORIES = [
  "全部组件 · 84",
  "开场与收尾 · 4",
  "产品展示 · 3",
  "数据与图表 · 15",
  "流程与图解 · 5",
  "地图与路径 · 12",
  "对比与背书 · 5",
  "知识讲解 · 2",
  "人物与观点 · 2",
  "文字与标注 · 4",
  "媒体与界面 · 5",
  "社交媒体 · 19",
  "代码演示 · 3",
  "品牌与营销 · 5",
];

async function expectCategoryOptions(ctx, expected, ariaLabel) {
  const options = await ctx.eval(`[
    ...document.querySelector('select[aria-label="${ariaLabel}"]').options
  ].map((option) => option.textContent.trim())`);
  ctx.assert(
    JSON.stringify(options) === JSON.stringify(expected),
    `Unexpected ${ariaLabel} options: ${JSON.stringify(options)}`,
  );
}

export default {
  id: "video-components-navigation",
  title: "Video Studio exposes one focused component workflow",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3387" },
  preserveTheme: true,
  steps: [
    {
      name: "The component taxonomy is complete in English",
      run: async (ctx) => {
        await ctx.prove("Video Studio presents all component categories in English", {
          voiceover: vo[0],
          action: async () => {
            await ctx.eval(
              'window.postMessage({ type: "ipollowork:studio-locale", locale: "en" }, "*")',
            );
            await ctx.waitFor('document.documentElement.lang === "en"', {
              label: "English Studio locale",
            });
            const inspectorOpen = await ctx.eval(
              'Boolean(document.querySelector("button[aria-label=\\"Components\\"]"))',
            );
            if (!inspectorOpen) {
              await ctx.trustedClick('button[aria-label="Properties"]');
            }
            await ctx.trustedClick('button[aria-label="Components"]');
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
              JSON.stringify(labels) === JSON.stringify(EXPECTED_ENGLISH_TABS),
              `Unexpected Video Studio tabs: ${JSON.stringify(labels)}`,
            );
            await expectCategoryOptions(ctx, EXPECTED_ENGLISH_CATEGORIES, "Component category");
            await ctx.expectText("All components · 84");
            await ctx.expectText("Brand Headline");
          },
          screenshot: {
            name: "component-taxonomy-english",
            // Electron's GPU surface intermittently hangs this CDP method;
            // capture the actual browser view instead of the compositor surface.
            fromSurface: false,
            requireText: [...EXPECTED_ENGLISH_TABS, "All components · 84", "Brand Headline"],
          },
        });
      },
    },
    {
      name: "The component taxonomy switches to Chinese",
      run: async (ctx) => {
        await ctx.prove("Video Studio switches the same component taxonomy to Chinese", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(
              'window.postMessage({ type: "ipollowork:studio-locale", locale: "zh-CN" }, "*")',
            );
            await ctx.waitFor('document.documentElement.lang === "zh-CN"', {
              label: "Chinese Studio locale",
            });
          },
          assert: async () => {
            const labels = await ctx.eval(`[
              ...document.querySelectorAll('.hf-inspector-tabs-scroll button[aria-label]')
            ].map((button) => button.getAttribute('aria-label'))`);
            ctx.assert(
              JSON.stringify(labels) === JSON.stringify(EXPECTED_CHINESE_TABS),
              `Unexpected Video Studio tabs: ${JSON.stringify(labels)}`,
            );
            await expectCategoryOptions(ctx, EXPECTED_CHINESE_CATEGORIES, "组件分类");
            await ctx.expectText("全部组件 · 84");
            await ctx.expectText("Brand Headline");
          },
          screenshot: {
            name: "component-taxonomy-chinese",
            fromSurface: false,
            requireText: [...EXPECTED_CHINESE_TABS, "全部组件 · 84", "Brand Headline"],
          },
        });
      },
    },
  ],
};
