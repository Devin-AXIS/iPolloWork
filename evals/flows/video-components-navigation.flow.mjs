import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-components-navigation");
const EXPECTED_ENGLISH_TABS = ["Layers", "Style", "Components", "Animation", "Sound", "Assets"];
const EXPECTED_CHINESE_TABS = ["图层", "主题", "组件", "动画", "声音", "素材"];
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
  await ctx.trustedClick(`button[aria-label="${ariaLabel}"]`);
  await ctx.waitFor("Boolean(document.querySelector('[role=listbox]'))");
  const options = await ctx.eval(`[...document.querySelectorAll('[role=listbox] [role=option]')].map(option=>option.textContent.trim())`);
  await ctx.trustedClick(`button[aria-label="${ariaLabel}"]`);
  ctx.assert(
    JSON.stringify(options) === JSON.stringify(expected),
    `Unexpected ${ariaLabel} options: ${JSON.stringify(options)}`,
  );
}

async function studioFrameContext(ctx) {
  const { frameTree } = await ctx.client.send("Page.getFrameTree");
  const frames = [];
  const collect = (node) => {
    frames.push(node.frame);
    for (const child of node.childFrames ?? []) collect(child);
  };
  collect(frameTree);
  const studioFrame = frames.find((frame) => frame.url.includes("ipwReload"));
  if (!studioFrame) throw new Error("Video Studio frame not found");
  const world = await ctx.client.send("Page.createIsolatedWorld", {
    frameId: studioFrame.id,
    worldName: "fraimz-video-component-navigation",
    grantUniveralAccess: true,
  });
  return world.executionContextId;
}

async function studioFrameEval(ctx, contextId, expression) {
  const response = await ctx.client.send("Runtime.evaluate", {
    contextId,
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function waitForStudioFrame(ctx, contextId, expression, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (await studioFrameEval(ctx, contextId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
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
if (process.env.IPOLLOWORK_EVAL_COMPONENT_BACK === "1") {
  flow.id = "video-component-parameters-navigation";
  flow.title = "Component parameters use Back without closing the inspector";
  flow.cdpTarget = { urlIncludes: "localhost:5173" };
  flow.steps = [{
    name: "Component parameters use hierarchical navigation",
    run: async (ctx) => {
      const contextId = await studioFrameContext(ctx);
      const paramsOpen = await studioFrameEval(
        ctx,
        contextId,
        'Boolean(document.querySelector("[data-testid=\\"block-params-panel\\"]"))',
      );
      if (!paramsOpen) {
        await studioFrameEval(
          ctx,
          contextId,
          `document.querySelector('[aria-label^="选择 Agenda Opener"]')?.click()`,
        );
      }
      await waitForStudioFrame(
        ctx,
        contextId,
        'Boolean(document.querySelector("[data-testid=\\"block-params-panel\\"]"))',
        "component parameter panel",
      );
      await ctx.prove("The component detail view uses Back while the panel keeps its separate Close action", {
        voiceover: "组件参数属于组件列表的下一层，因此左上角使用返回按钮；面板右上角仍负责关闭整个属性面板。",
        action: async () => undefined,
        assert: async () => {
          const state = await studioFrameEval(ctx, contextId, `(() => ({
            back: Boolean(document.querySelector('button[aria-label="返回组件列表"]')),
            oldClose: Boolean(document.querySelector('button[aria-label="关闭参数"]')),
            panelClose: Boolean(document.querySelector('button[aria-label="关闭右侧面板"]')),
            autosaved: Boolean(document.querySelector('[data-save-state="saved"]')),
            aiSummary: document.querySelector('[data-testid="block-params-panel"]')?.textContent.includes('AI 可修改'),
            hasThemeTag: document.querySelector('[data-testid="block-params-panel"]')?.textContent.includes('跟随主题'),
            hasVideoTag: document.querySelector('[data-testid="block-params-panel"]')?.textContent.includes('VIDEO'),
            liveLabels: [...document.querySelectorAll('[data-testid="block-params-panel"] *')].filter((element) => element.textContent.trim() === 'LIVE').length,
            title: Boolean(document.querySelector('input[aria-label="标题"]')),
            itemRows: document.querySelectorAll('[data-component-data-row]').length,
            itemCount: document.querySelector('[data-testid="block-params-panel"]')?.textContent.includes('4 项'),
            encodedItems: document.querySelector('[data-testid="block-params-panel"]')?.textContent.includes('01::Context'),
            highlight: Boolean(document.querySelector('[aria-label="高亮条目"]')),
            note: Boolean(document.querySelector('input[aria-label="补充说明"]')),
          }))()`);
          ctx.assert(
            state.back &&
              !state.oldClose &&
              state.panelClose &&
              state.autosaved &&
              !state.aiSummary &&
              !state.hasThemeTag &&
              !state.hasVideoTag &&
              state.liveLabels === 0 &&
              state.title &&
              state.itemRows === 4 &&
              state.itemCount &&
              !state.encodedItems &&
              state.highlight &&
              state.note,
            `Unexpected component detail UI: ${JSON.stringify(state)}`,
          );
        },
        screenshot: { name: "component-parameters-structured-form" },
      });
      await ctx.prove("Back returns to the component catalog without closing the right panel", {
        voiceover: "点击返回后回到组件列表，右侧面板保持打开，用户可以继续选择其他组件。",
        action: async () => {
          await studioFrameEval(ctx, contextId, 'document.querySelector("button[aria-label=\\"返回组件列表\\"]")?.click()');
          await waitForStudioFrame(
            ctx,
            contextId,
            'Boolean(document.querySelector("[data-testid=\\"block-catalog-search\\"]")) && !document.querySelector("[data-testid=\\"block-params-panel\\"]")',
            "component catalog after Back",
          );
        },
        assert: async () => {
          const state = await studioFrameEval(ctx, contextId, `(() => ({
            catalog: Boolean(document.querySelector('[data-testid="block-catalog-search"]')),
            parameters: Boolean(document.querySelector('[data-testid="block-params-panel"]')),
            panelClose: Boolean(document.querySelector('button[aria-label="关闭右侧面板"]')),
          }))()`);
          ctx.assert(state.catalog && !state.parameters && state.panelClose, `Back navigation failed: ${JSON.stringify(state)}`);
        },
        screenshot: { name: "back-to-component-catalog" },
      });
    },
  }];
}
export default flow;
