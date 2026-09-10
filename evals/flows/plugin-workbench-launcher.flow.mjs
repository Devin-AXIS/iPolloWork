import { connect } from "../runner/cdp.mjs";

const launcher = `document.querySelector('[aria-label="添加侧面板入口"]')`;
const xhsEntry = `document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]')`;
const xhsFrame = `document.querySelector('iframe[title="小红书运营台"]')`;

export default {
  id: "plugin-workbench-launcher",
  title: "从右侧菜单打开已安装插件的工作台",
  kind: "user-facing",
  steps: [{
    name: "已安装工作台自动出现在菜单，并在右侧打开",
    async run(ctx) {
      await ctx.waitFor(`Boolean(${launcher})`);
      await ctx.prove("菜单同时展示 UI 页面与本地服务型工作台", {
        voiceover: "点击右侧加号，可以直接找到视频、图片和小红书运营台。",
        action: async () => {
          if (!await ctx.eval(`Boolean(${xhsEntry})`)) await ctx.eval(`${launcher}.click()`);
          await ctx.waitFor(`Boolean(${xhsEntry})`);
        },
        assert: async () => {
          const names = await ctx.eval(`[...document.querySelectorAll('[data-testid^="side-panel-launcher-workspace-app:"]')].map(el => el.textContent.trim())`);
          for (const name of ["视频工作台", "图片工作台", "小红书运营台"]) {
            ctx.assert(names.filter(value => value === name).length === 1, `Missing or duplicated entry: ${name}`);
          }
          ctx.assert(await ctx.eval(`${xhsEntry}.getAttribute('aria-disabled') !== 'true'`), "Existing workbench must remain selectable.");
        },
        screenshot: "installed-workbench-menu",
      });
      await ctx.prove("点击入口直接打开小红书账号管理，不向 AI 发送消息", {
        voiceover: "选择小红书运营台，右侧直接显示账号管理，左侧不会进入思考；再次选择会回到已有页面。",
        action: async () => {
          await ctx.eval(`${xhsEntry}.click()`);
          await ctx.waitFor(`Boolean(${xhsFrame}?.src)`);
          const otherTab = `[...document.querySelectorAll('[aria-label^="Select tab:"]')].find(el => el.getAttribute('aria-label') !== 'Select tab: 小红书运营台')`;
          if (await ctx.eval(`Boolean(${otherTab})`)) await ctx.eval(`${otherTab}.click()`);
          await ctx.eval(`${launcher}.click()`);
          await ctx.waitFor(`Boolean(${xhsEntry})`);
          await ctx.eval(`${xhsEntry}.click()`);
          await ctx.waitFor(`Boolean(${xhsFrame}?.src)`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelectorAll('[aria-label="Select tab: 小红书运营台"]').length === 1`), "Repeated selection created a duplicate tab.");
          await assertWorkbenchPage(ctx, xhsFrame, ['账号管理', '已接入账号', '接入账号']);
          ctx.assert(await ctx.eval(`!document.querySelector('button[aria-label="停止"]')`), 'Opening the workbench started an AI turn.');
        },
        screenshot: "xiaohongshu-right-workbench",
      });
    },
  }, {
    name: "从加号启动仅提供本地服务的数据标注工作台",
    async run(ctx) {
      const entry = `document.querySelector('[data-testid="side-panel-launcher-workspace-app:labelu-data-annotation:workspace-app:labelu-data-annotation-service"]')`;
      const frame = `document.querySelector('iframe[title="数据标注实训云"]')`;
      await ctx.prove("数据标注实训云从菜单直接启动，并在右侧 iframe 展示可用标注页面", {
        voiceover: "选择数据标注实训云，插件会启动本地服务，右侧直接显示图片、视频、音频和文字标注入口。",
        action: async () => {
          await ctx.eval(`${launcher}.click()`);
          await ctx.waitFor(`Boolean(${entry})`);
          await ctx.eval(`${entry}.click()`);
          await ctx.waitFor(`Boolean(${frame}?.src)`);
        },
        assert: async () => {
          await assertWorkbenchPage(ctx, frame, ["图片标注", "视频标注", "音频标注", "文字标注", "我的标注"]);
          ctx.assert(await ctx.eval(`${frame}.getBoundingClientRect().width > 200`), "Workbench frame is not visible.");
          ctx.assert(await ctx.eval(`document.querySelectorAll('[aria-label="Select tab: 数据标注实训云"]').length === 1`), "Workbench tab is duplicated.");
        },
        screenshot: "annotation-service-workbench",
      });
    },
  }],
};


async function assertWorkbenchPage(ctx, frame, labels) {
  const address = await ctx.eval(`${frame}.src`);
  const targets = await (await fetch(`${ctx.cdpBaseUrl}/json/list`)).json();
  const target = targets.find(value => value.type === 'iframe' && value.url === address);
  ctx.assert(Boolean(target), 'Workbench did not load as an embedded iframe.');
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    let pageText = '';
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await client.send('Runtime.evaluate', { expression: 'document.body?.innerText', returnByValue: true });
      pageText = result.result.value || '';
      if (labels.every(label => pageText.includes(label))) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    for (const label of labels) ctx.assert(pageText.includes(label), `Workbench content missing: ${label}`);
  } finally { client.close(); }
}
