import {
  connect,
  debuggerUrlFor,
  evaluate,
  listTargets,
} from "../runner/cdp.mjs";

const plugins = {
  xiaohongshu: {
    id: "xiaohongshu-ops",
    title: "小红书运营台",
  },
  douyin: {
    id: "douyin-ops",
    title: "抖音运营台",
  },
};

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function ensureWorkbench(ctx, plugin) {
  const tabSelector = `[aria-label="Select tab: ${plugin.title}"]`;
  const frameSelector = `iframe[title="${plugin.title}"]`;
  const launcherSelector = `[data-testid="side-panel-launcher-workspace-app:${plugin.id}:workspace-app:workbench"]`;

  if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(tabSelector)}))`)) {
    if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(launcherSelector)}))`)) {
      await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]')?.click()`);
      await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(launcherSelector)}))`, {
        timeoutMs: 30_000,
        label: `${plugin.title} launcher`,
      });
    }
    await ctx.eval(`document.querySelector(${JSON.stringify(launcherSelector)}).click()`);
  }

  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(frameSelector)})?.src)`, {
    timeoutMs: 60_000,
    label: `${plugin.title} iframe`,
  });
  await ctx.eval(`document.querySelector(${JSON.stringify(tabSelector)})?.click()`);
  const origin = new URL(await ctx.eval(`document.querySelector(${JSON.stringify(frameSelector)}).src`)).origin;

  let target = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    target = (await listTargets(ctx.cdpBaseUrl)).find((entry) =>
      entry.type === "iframe" && entry.url.startsWith(`${origin}/`),
    );
    if (target) break;
    await pause(250);
  }
  ctx.assert(target, `${plugin.title} did not expose a captureable iframe target`);
  return {
    client: await connect(debuggerUrlFor(ctx.cdpBaseUrl, target)),
    target,
  };
}

async function waitForFrame(client, expression, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(client, expression).catch(() => false)) return;
    await pause(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export default {
  id: "social-plugin-account-header",
  title: "小红书与抖音只在标题栏切换和添加账号",
  kind: "user-facing",
  preserveTheme: true,
  steps: [
    {
      name: "小红书所有模块共用顶部账号入口",
      run: async (ctx) => {
        const { client, target } = await ensureWorkbench(ctx, plugins.xiaohongshu);
        const initialUrl = await evaluate(client, "location.href");
        try {
          await waitForFrame(client, "Boolean(document.querySelector('.app-topbar .account-picker'))", "Xiaohongshu account header");
          await ctx.prove("小红书只在顶部标题栏切换和添加账号", {
            voiceover: "小红书的当前账号、切换入口和添加账号已经统一放到运营台标题栏。账号、发帖、评论和数据页共用这一处入口。",
            action: async () => {
              for (const path of ["/accounts", "/publishing", "/comments", "/analytics"]) {
                await evaluate(client, `document.querySelector(${JSON.stringify(`nav a[href^="${path}"]`)})?.click()`);
                await waitForFrame(client, `location.pathname === ${JSON.stringify(path)}`, `Xiaohongshu ${path}`);
                const state = await evaluate(client, `({
                  path: location.pathname,
                  hasPicker: Boolean(document.querySelector('.app-topbar .account-picker')),
                  hasAdd: Boolean(document.querySelector('.app-topbar .add-account-link')),
                  mainAccountControls: document.querySelectorAll('.app-main .account-bar, .app-main .account-picker, .app-main .add-account-link').length,
                })`);
                ctx.assert(state.hasPicker && state.hasAdd, `Xiaohongshu header controls disappeared on ${path}`);
                ctx.assert(state.mainAccountControls === 0, `Xiaohongshu page body duplicates account controls on ${path}`);
              }
              await evaluate(client, `document.querySelector('nav a[href^="/publishing"]')?.click()`);
              await waitForFrame(client, "location.pathname === '/publishing'", "Xiaohongshu publishing page");
            },
            assert: async () => {
              const placement = await evaluate(client, `({
                title: document.querySelector('.app-topbar .app-identity strong')?.textContent?.trim(),
                pickerInHeader: Boolean(document.querySelector('.app-topbar .account-picker')),
                addInHeader: Boolean(document.querySelector('.app-topbar .add-account-link')),
                pageDuplicates: document.querySelectorAll('.app-main .account-bar, .app-main .account-picker, .app-main .add-account-link').length,
              })`);
              ctx.assert(placement.title === "小红书运营台", "Xiaohongshu title bar is missing");
              ctx.assert(placement.pickerInHeader && placement.addInHeader, "Xiaohongshu account controls are outside the title bar");
              ctx.assert(placement.pageDuplicates === 0, "Xiaohongshu module page still duplicates account controls");
            },
            screenshot: {
              name: "xiaohongshu-account-header",
              textTargetId: target.id,
              requireText: ["小红书运营台", "添加账号", "发帖"],
              rejectText: ["Something went wrong"],
            },
          });
        } finally {
          await client.send("Page.navigate", { url: initialUrl }).catch(() => {});
          client.close();
        }
      },
    },
    {
      name: "抖音所有模块共用顶部账号入口",
      run: async (ctx) => {
        const { client, target } = await ensureWorkbench(ctx, plugins.douyin);
        try {
          await waitForFrame(client, "Boolean(document.querySelector('.topbar-account #account'))", "Douyin account header");
          await ctx.prove("抖音只在顶部标题栏切换和添加账号", {
            voiceover: "抖音也使用同一套位置规则。切换账号和添加账号位于标题栏，概览、创作、作品、评论、搜索和记录页不再各自提供账号入口。",
            action: async () => {
              const views = await evaluate(client, "[...document.querySelectorAll('.tabs [data-view]')].map((entry) => entry.dataset.view)");
              for (const view of views) {
                await evaluate(client, `document.querySelector(${JSON.stringify(`.tabs [data-view="${view}"]`)})?.click()`);
                await waitForFrame(client, `!document.querySelector(${JSON.stringify(`#view-${view}`)})?.hidden`, `Douyin ${view} view`);
                const state = await evaluate(client, `({
                  hasPicker: Boolean(document.querySelector('.topbar-account #account')),
                  hasAdd: Boolean(document.querySelector('.topbar-account #add-account')),
                  viewAccountControls: document.querySelectorAll(${JSON.stringify(`#view-${view} #account, #view-${view} #add-account, #view-${view} .topbar-account`)}).length,
                })`);
                ctx.assert(state.hasPicker && state.hasAdd, `Douyin header controls disappeared on ${view}`);
                ctx.assert(state.viewAccountControls === 0, `Douyin module duplicates account controls on ${view}`);
              }
              await evaluate(client, "document.querySelector('.tabs [data-view=studio]')?.click()");
              await waitForFrame(client, "!document.querySelector('#view-studio')?.hidden", "Douyin studio view");
            },
            assert: async () => {
              const placement = await evaluate(client, `({
                title: document.querySelector('.topbar h1')?.textContent?.trim(),
                pickerInHeader: Boolean(document.querySelector('.topbar-account #account')),
                addInHeader: Boolean(document.querySelector('.topbar-account #add-account')),
                sidebarDuplicates: document.querySelectorAll('.sidebar #account, .sidebar #add-account').length,
              })`);
              ctx.assert(placement.title === "抖音运营台", "Douyin title bar is missing");
              ctx.assert(placement.pickerInHeader && placement.addInHeader, "Douyin account controls are outside the title bar");
              ctx.assert(placement.sidebarDuplicates === 0, "Douyin sidebar still duplicates account controls");
            },
            screenshot: {
              name: "douyin-account-header",
              textTargetId: target.id,
              requireText: ["抖音运营台", "添加账号", "视频创作"],
              rejectText: ["Something went wrong"],
            },
          });
        } finally {
          client.close();
        }
      },
    },
  ],
};
