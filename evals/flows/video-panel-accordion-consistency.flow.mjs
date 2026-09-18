async function studioContext(ctx) {
  const { frameTree } = await ctx.client.send("Page.getFrameTree");
  const frame = frameTree.childFrames?.find(({ frame }) => frame.url.includes(":3562"))?.frame;
  if (!frame) throw new Error("Video Studio iframe is not open");
  const world = await ctx.client.send("Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: "fraimz-video-panel-accordion",
  });
  return world.executionContextId;
}

async function studioEval(ctx, contextId, expression) {
  const response = await ctx.client.send("Runtime.evaluate", {
    contextId,
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function openTab(ctx, contextId, label) {
  if (!await studioEval(ctx, contextId,
    `Boolean(document.querySelector('button[aria-label="${label}"]'))`)) {
    await studioEval(ctx, contextId,
      `document.querySelector('button[aria-label="属性"]')?.click()`);
  }
  await waitStudio(ctx, contextId,
    `Boolean(document.querySelector('button[aria-label="${label}"]'))`, `${label} tab`);
  await studioEval(ctx, contextId,
    `document.querySelector('button[aria-label="${label}"]')?.click()`);
  await waitStudio(ctx, contextId,
    `Boolean(document.querySelector('button[aria-label="${label}"][aria-pressed="true"]'))`, `${label} active`);
}

async function waitStudio(ctx, contextId, expression, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await studioEval(ctx, contextId, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const headerStyles = `(() => [...document.querySelectorAll('.hf-panel-accordion-header')]
  .slice(0, 3).map(header => ({
    height: getComputedStyle(header).height,
    font: getComputedStyle(header.querySelector('.hf-panel-accordion-label')).fontSize,
    arrow: Boolean(header.querySelector('.hf-panel-accordion-chevron')),
    expanded: header.getAttribute('aria-expanded') ?? header.getAttribute('data-expanded'),
    accent: getComputedStyle(header).boxShadow.includes('31, 186, 192'),
  })))()`;

export default {
  id: "video-panel-accordion-consistency",
  title: "Video panel accordion style and expansion rules",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:5173" },
  preserveTheme: true,
  steps: [
    { name: "Components keep independent expansion", run: async ctx => {
      const contextId = await studioContext(ctx);
      await ctx.prove("Component groups share the compact accordion style and open independently", {
        voiceover: "组件分组使用统一的箭头、字级、行高和展开标记，并可同时展开多组。",
        action: async () => {
          await openTab(ctx, contextId, "组件");
          await waitStudio(ctx, contextId,
            `Boolean(document.querySelector('[data-testid="component-section-header"]'))`,
            "component groups");
          await studioEval(ctx, contextId,
            `(() => {
              const headers = document.querySelectorAll('[data-testid="component-section-header"]');
              if (headers[0]?.getAttribute('aria-expanded') === 'true') headers[0].click();
              if (headers[1]?.getAttribute('aria-expanded') === 'false') headers[1].click();
            })()`);
          await waitStudio(ctx, contextId,
            `document.querySelector('[data-testid="component-section-header"]')?.getAttribute('aria-expanded') === 'false'`,
            "component group collapse");
        },
        assert: async () => {
          const rows = await studioEval(ctx, contextId, headerStyles);
          ctx.assert(rows.length >= 2 && rows.every(row => row.height === "48px" && row.font === "13px" && row.arrow), JSON.stringify(rows));
          ctx.assert(rows[0].expanded === "false" && rows[1].expanded === "true" && !rows[0].accent && rows[1].accent, JSON.stringify(rows));
        },
        screenshot: { name: "component-groups" },
      });
    }},
    { name: "Assets keep independent expansion", run: async ctx => {
      const contextId = await studioContext(ctx);
      await ctx.prove("Asset groups use the same header and can remain open together", {
        voiceover: "素材分组采用相同的视觉规范，关闭图片组不会关闭其他素材组。",
        action: async () => {
          await openTab(ctx, contextId, "素材");
          await waitStudio(ctx, contextId,
            `Boolean(document.querySelector('[data-testid="assets-virtual-scroll"] .hf-panel-accordion-header'))`,
            "asset groups");
          await studioEval(ctx, contextId,
            `(() => {
              const headers = document.querySelectorAll('[data-testid="assets-virtual-scroll"] .hf-panel-accordion-header');
              if (headers[0]?.getAttribute('aria-expanded') === 'true') headers[0].click();
              if (headers[1]?.getAttribute('aria-expanded') === 'false') headers[1].click();
            })()`);
          await waitStudio(ctx, contextId,
            `document.querySelector('[data-testid="assets-virtual-scroll"] .hf-panel-accordion-header')?.getAttribute('aria-expanded') === 'false'`,
            "asset group collapse");
        },
        assert: async () => {
          const rows = await studioEval(ctx, contextId, headerStyles);
          ctx.assert(rows.length >= 2 && rows.every(row => row.height === "48px" && row.font === "13px" && row.arrow), JSON.stringify(rows));
          ctx.assert(rows[0].expanded === "false" && rows[1].expanded === "true" && !rows[0].accent && rows[1].accent, JSON.stringify(rows));
        },
        screenshot: { name: "asset-groups" },
      });
    }},
    { name: "Layers default to a relevant group and allow multiple open", run: async ctx => {
      const contextId = await studioContext(ctx);
      await ctx.prove("Layer properties open a relevant group by default and allow another to stay open", {
        voiceover: "图层默认展开有参数的分组，之后可同时展开多个分组。",
        action: async () => {
          await openTab(ctx, contextId, "图层");
          await studioEval(ctx, contextId,
            `document.querySelector('[aria-label="选择 Scene Summary"]')?.click()`);
          await waitStudio(ctx, contextId,
            `document.querySelector('[data-testid="figma-property-inspector"]')?.textContent.includes('Scene Summary')`,
            "scene layer selection");
          await studioEval(ctx, contextId,
            `document.querySelector('[aria-label="选择 Ambient Layer"]')?.click()`);
          await waitStudio(ctx, contextId,
            `document.querySelector('[data-testid="figma-property-inspector"]')?.textContent.includes('Ambient Layer')`,
            "ambient layer selection");
          await new Promise(resolve => setTimeout(resolve, 250));
        },
        assert: async () => {
          const before = await studioEval(ctx, contextId, headerStyles);
          ctx.assert(before.length >= 2 && before[0].expanded === "true" && before[0].accent, JSON.stringify(before));
          ctx.assert(before.every(row => row.height === "48px" && row.font === "13px" && row.arrow), JSON.stringify(before));
          ctx.assert(await studioEval(ctx, contextId,
            `Boolean(document.querySelector('[data-flat-group-open] [data-flat-group-content]'))`),
            "Default layer group has editable content");
          await studioEval(ctx, contextId,
            `document.querySelectorAll('.hf-panel-accordion-header')[1]?.click()`);
          await waitStudio(ctx, contextId,
            `document.querySelectorAll('.hf-panel-accordion-header')[1]?.getAttribute('data-expanded') === 'true'`,
            "layer group switch");
          const after = await studioEval(ctx, contextId, headerStyles);
          ctx.assert(after[0].expanded === "true" && after[1].expanded === "true" && after[0].accent && after[1].accent, JSON.stringify(after));
          await new Promise(resolve => setTimeout(resolve, 250));
        },
        screenshot: { name: "layer-groups" },
      });
    }},
    { name: "Layer summaries use readable right-aligned text", run: async ctx => {
      const contextId = await studioContext(ctx);
      await ctx.prove("Collapsed layer summaries use 12px interface text aligned to the right edge", {
        voiceover: "图层分组后的参数摘要统一为十二像素界面字体，靠右对齐，与左侧标题形成清晰层级。",
        action: async () => {
          await openTab(ctx, contextId, "图层");
          await studioEval(ctx, contextId,
            `[...document.querySelectorAll('[data-flat-group-open] button[aria-expanded="true"]')].forEach(button => button.click())`);
          await waitStudio(ctx, contextId,
            `!document.querySelector('[data-flat-group-open]')`, "collapsed layer groups");
          await waitStudio(ctx, contextId,
            `[...document.querySelectorAll('[data-flat-group-collapsed]')].every(header => getComputedStyle(header).opacity === '1')`, "settled layer headers");
        },
        assert: async () => {
          const summaries = await studioEval(ctx, contextId, `(() =>
            [...document.querySelectorAll('[data-flat-group-collapsed] > span[title]')].map(summary => {
              const header = summary.parentElement;
              const style = getComputedStyle(summary);
              return {
                size: style.fontSize,
                weight: style.fontWeight,
                sameFont: style.fontFamily === getComputedStyle(header.querySelector('.hf-panel-accordion-label')).fontFamily,
                rightAligned: style.textAlign === 'right' && Math.abs(header.getBoundingClientRect().right - summary.getBoundingClientRect().right - 16) < 1,
                fullText: summary.title === summary.textContent.trim(),
              };
            }))()`);
          ctx.assert(summaries.length >= 4 && summaries.every(summary =>
            summary.size === '12px' && summary.weight === '400' && summary.sameFont && summary.rightAligned && summary.fullText), JSON.stringify(summaries));
        },
        screenshot: { name: "layer-summary-typography" },
      });
    }},
  ],
};
