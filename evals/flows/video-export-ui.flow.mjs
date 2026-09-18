async function studioContext(ctx) {
  const { frameTree } = await ctx.client.send("Page.getFrameTree");
  const frame = frameTree.childFrames?.find(({ frame }) => frame.urlFragment?.includes("#project/"))?.frame;
  if (!frame) throw new Error("Video Studio iframe is not open");
  const world = await ctx.client.send("Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: "fraimz-video-export-ui",
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

async function waitStudio(ctx, contextId, expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await studioEval(ctx, contextId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

export default {
  id: "video-export-ui",
  title: "Video export drawer control consistency",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:5173" },
  preserveTheme: true,
  steps: [{
    name: "Export dropdown and menu follow the Studio control style",
    run: async (ctx) => {
      const contextId = await studioContext(ctx);
      await ctx.prove("The export title, dropdown triggers, popup and action share the Studio visual scale", {
        voiceover: "导出面板的标题、下拉框及展开浮层遵循视频工作室的同一套控件样式。",
        action: async () => {
          await waitStudio(ctx, contextId, `Boolean(document.querySelector('.hf-studio-header-export'))`);
          if (!await studioEval(ctx, contextId, `Boolean(document.querySelector('.hf-export-button'))`)) {
            await studioEval(ctx, contextId, `document.querySelector('.hf-studio-header-export')?.click()`);
          }
          await waitStudio(ctx, contextId, `Boolean(document.querySelector('button[aria-label="格式"]'))`);
          await studioEval(ctx, contextId, `document.querySelector('button[aria-label="格式"]')?.click()`);
          await waitStudio(ctx, contextId, `Boolean(document.querySelector('[role="listbox"][aria-label="格式"]'))`);
        },
        assert: async () => {
          const result = await studioEval(ctx, contextId, `(() => {
            const heading = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '导出');
            const selects = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].filter(el => ['格式', '分辨率', '帧率', '质量'].includes(el.ariaLabel));
            const menu = document.querySelector('[role="listbox"][aria-label="格式"]');
            const button = document.querySelector('.hf-export-button');
            const style = el => getComputedStyle(el);
            return {
              heading: heading && {font: style(heading).fontSize, weight: style(heading).fontWeight},
              selects: selects.map(el => ({label: el.ariaLabel, height: el.getBoundingClientRect().height, radius: style(el).borderRadius, font: style(el).fontSize})),
              menu: menu && {radius: style(menu).borderRadius, background: style(menu).backgroundColor, options: menu.querySelectorAll('[role="option"]').length},
              button: button && {height: button.getBoundingClientRect().height, background: style(button).backgroundColor, color: style(button).color, disabled: button.disabled},
            };
          })()`);
          ctx.assert(result.heading?.font === "13px" && result.heading.weight === "600", JSON.stringify(result));
          ctx.assert(result.selects.length === 4 && result.selects.every(select => select.height === 34 && select.radius === "6px" && select.font === "12px"), JSON.stringify(result));
          ctx.assert(result.menu?.radius === "6px" && result.menu.options === 3 && result.menu.background !== "rgba(0, 0, 0, 0)", JSON.stringify(result));
          ctx.assert(result.button?.height === 34 && result.button.background !== result.button.color && !result.button.disabled, JSON.stringify(result));
        },
        screenshot: { name: "video-export-dropdown" },
      });
    },
  }, {
    name: "Export format selection preserves dependent settings",
    run: async (ctx) => {
      const contextId = await studioContext(ctx);
      await ctx.prove("Selecting MOV hides its inapplicable quality field and MP4 restores it", {
        voiceover: "切换到 MOV 时质量设置会收起，返回 MP4 后可继续调整。",
        action: async () => {
          await studioEval(ctx, contextId, `(() => {
            const mov = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(el => el.textContent.includes('MOV'));
            mov?.click();
          })()`);
        },
        assert: async () => {
          ctx.assert(await studioEval(ctx, contextId, `!document.querySelector('button[aria-label="质量"]')`), "MOV should hide quality");
          await studioEval(ctx, contextId, `document.querySelector('button[aria-label="格式"]')?.click()`);
          await studioEval(ctx, contextId, `(() => {
            const mp4 = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(el => el.textContent.trim() === 'MP4');
            mp4?.click();
          })()`);
          ctx.assert(await studioEval(ctx, contextId, `Boolean(document.querySelector('button[aria-label="质量"]'))`), "MP4 should restore quality");
        },
        screenshot: { name: "video-export-mp4-restored" },
      });
    },
  }],
};
