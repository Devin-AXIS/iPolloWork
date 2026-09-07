import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-components-navigation");
const EXPECTED_ENGLISH_TABS = ["Layers", "Style", "Components", "Animation", "Voice", "Assets"];
const EXPECTED_CHINESE_TABS = ["图层", "主题", "组件", "动画", "配音", "素材"];
const EXPECTED_ENGLISH_CATEGORIES = [
  "All components · 150",
  "Openers & Endings · 9",
  "Product Showcase · 10",
  "Data & Charts · 22",
  "Flows & Diagrams · 12",
  "Maps & Routes · 12",
  "Comparison & Proof · 10",
  "Knowledge · 8",
  "People & Quotes · 6",
  "Text & Labels · 10",
  "Media & UI · 11",
  "Social Media · 22",
  "Code Demos · 8",
  "Brand & Marketing · 10",
];
const EXPECTED_CHINESE_CATEGORIES = [
  "全部组件 · 150",
  "开场与收尾 · 9",
  "产品展示 · 10",
  "数据与图表 · 22",
  "流程与图解 · 12",
  "地图与路径 · 12",
  "对比与背书 · 10",
  "知识讲解 · 8",
  "人物与观点 · 6",
  "文字与标注 · 10",
  "媒体与界面 · 11",
  "社交媒体 · 22",
  "代码演示 · 8",
  "品牌与营销 · 10",
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
            await ctx.expectText("All components · 150");
            await ctx.expectText("Brand Headline");
          },
          screenshot: {
            name: "component-taxonomy-english",
            requireText: [...EXPECTED_ENGLISH_TABS, "All components · 150", "Brand Headline"],
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
            await ctx.expectText("全部组件 · 150");
            await ctx.expectText("Brand Headline");
          },
          screenshot: {
            name: "component-taxonomy-chinese",
            requireText: [...EXPECTED_CHINESE_TABS, "全部组件 · 150", "Brand Headline"],
          },
        });
      },
    },
  ],
};
