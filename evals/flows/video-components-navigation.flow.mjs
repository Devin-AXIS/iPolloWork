import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-components-navigation");
const EXPECTED_ENGLISH_TABS = ["Layers", "Style", "Components", "Animation", "Narration", "Assets"];
const EXPECTED_CHINESE_TABS = ["图层", "主题", "组件", "动画", "讲解", "素材"];
const EXPECTED_ENGLISH_CATEGORIES = [
  "All components", "Maps & Routes", "Media & UI", "Business Diagrams",
];
const EXPECTED_CHINESE_CATEGORIES = [
  "全部组件", "地图与路径", "媒体与界面", "商业图库",
];

async function expectCategoryOptions(ctx, expected, ariaLabel) {
  if (await ctx.eval("Boolean(document.querySelector('[role=listbox]'))")) {
    await ctx.trustedClick(`button[aria-label="${ariaLabel}"]`);
  }
  await ctx.trustedClick(`button[aria-label="${ariaLabel}"]`);
  await ctx.waitFor("Boolean(document.querySelector('[role=listbox]'))");
  const options = await ctx.eval(`[...document.querySelectorAll('[role=listbox] [role=option]')].map(option=>option.textContent.trim())`);
  const labels = options.map(option => option.split(" · ")[0]);
  ctx.assert(JSON.stringify(labels) === JSON.stringify(expected), `Unexpected ${ariaLabel} options: ${JSON.stringify(options)}`);
  const counts = options.map(option => Number(option.split(" · ")[1]));
  ctx.assert(counts.every(Number.isInteger) && counts[0] === counts.slice(1).reduce((sum, count) => sum + count, 0) && counts[0] >= 26,
    `Component category counts are inconsistent: ${JSON.stringify(options)}`);
}

const flow = {
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
              if (!await ctx.eval(`Boolean(document.querySelector('button[aria-label="Components"]'))`)) await ctx.trustedClick('button[aria-label="Properties"]');
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
            await ctx.expectText("Maps & Routes · 12");
          },
          screenshot: {
            name: "component-taxonomy-english",
            requireText: [...EXPECTED_ENGLISH_TABS, "Maps & Routes · 12"],
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
            await ctx.expectText("地图与路径 · 12");
          },
          screenshot: {
            name: "component-taxonomy-chinese",
            requireText: [...EXPECTED_CHINESE_TABS, "地图与路径 · 12"],
          },
        });
      },
    },
  ],
};

if (process.env.IPOLLOWORK_EVAL_COMPONENT_CARDS === "1") flow.steps = [{name:"Component card preview and actions",run:async ctx=>{
 if (!await ctx.eval(`Boolean(document.querySelector('button[aria-label="Components"]'))`)) await ctx.trustedClick('button[aria-label="Properties"]');
 await ctx.trustedClick('button[aria-label="Components"]');
 await ctx.waitFor("Boolean(document.querySelector('[data-testid=block-catalog-card]'))");
 await ctx.eval("window.__cardRequests=[];window.__cardFetch=window.fetch;window.fetch=async(input,init)=>{if(init?.method==='POST'){window.__cardRequests.push(String(input));return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});}return window.__cardFetch(input,init);};window.__cardAi=null;window.__cardListener=e=>{if(e.data?.type==='ipollowork:hyperframes:animation-reference')window.__cardAi=e.data;};window.addEventListener('message',window.__cardListener)");
 try {
 await ctx.prove('Clicking a component previews it without insertion',{voiceover:vo[0],
 action:async()=>{await ctx.trustedClick('[data-testid=block-catalog-card]');await ctx.waitFor("Boolean(document.querySelector('[role=dialog]'))");await ctx.eval("new Promise(resolve=>setTimeout(resolve,1200))",{awaitPromise:true});},
 assert:async()=>ctx.assert(await ctx.eval("window.__cardRequests.length===0 && Boolean(document.querySelector('[role=dialog] button[aria-label=\"Insert component\"]')) && Boolean(document.querySelector('[role=dialog] button[aria-label=\"Ask AI\"]'))"),'Preview has both actions and does not insert'),
 screenshot:{name:'component-card-preview',requireText:['Insert component']}});
 await ctx.prove('Ask AI passes the component reference and closes the preview',{voiceover:vo[1],
 action:async()=>{await ctx.trustedClick('[role=dialog] button[aria-label="Ask AI"]');await ctx.waitFor('Boolean(window.__cardAi)');},
 assert:async()=>ctx.assert(await ctx.eval("!document.querySelector('[role=dialog]') && Boolean(window.__cardAi.animation.name) && window.__cardRequests.length===0"),'AI reference is delivered without inserting'),
 screenshot:{name:'component-card-actions'}});
 }finally{await ctx.eval('window.fetch=window.__cardFetch;window.removeEventListener("message",window.__cardListener);delete window.__cardFetch;delete window.__cardListener;');}
}}];
export default flow;
