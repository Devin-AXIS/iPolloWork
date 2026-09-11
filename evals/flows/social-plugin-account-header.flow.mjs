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
            voiceover: "小红书已移除账号页面。顶部下拉查看账号和登录状态，添加账号打开弹窗，关闭后继续当前创作。",
            action: async () => {
              for (const path of ["/publishing", "/comments", "/analytics"]) {
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
              ctx.assert(await evaluate(client, "!document.querySelector('.app-sidebar nav a[href^=\"/accounts\"]')"), "Account navigation remains");
              await evaluate(client, "document.querySelector('.account-picker summary').click()");
              const entries = await evaluate(client, "[...document.querySelectorAll('.account-menu a')].map(a => ({href:a.href, text:a.innerText}))");
              ctx.assert(entries.length > 0 && entries.every(a => a.text.includes('·')), "Dropdown lacks account status");
              const other = entries[1];
              if (other) {
                await client.send("Page.navigate", { url: other.href });
                await waitForFrame(client, "location.pathname === '/publishing' && Boolean(document.querySelector('.account-picker'))", "Switch account");
                ctx.assert(await evaluate(client, "location.href") === other.href, "Account switch failed");
              }
              await evaluate(client, "document.querySelector('[data-open-account-form]').click()");
              await waitForFrame(client, "document.querySelector('#account-onboarding').open", "Add account dialog");
              await evaluate(client, "document.querySelector('[data-close-account-form]').click()");
              ctx.assert(await evaluate(client, "!document.querySelector('#account-onboarding').open && location.pathname === '/publishing'"), "Closing dialog left module");
              await evaluate(client, "document.querySelector('[data-open-account-form]').click()");
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
              ctx.assert(await evaluate(client, "document.querySelector('#account-onboarding').open"), "Add dialog is not open");
            },
            screenshot: {
              name: "xiaohongshu-account-header",
              textTargetId: target.id,
              requireText: ["小红书运营台", "扫码登录新账号", "保存账号"],
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
            voiceover: "抖音已移除账号页面。顶部下拉显示账号与授权状态，新增账号在弹窗中完成配置和授权，关闭后保留当前模块。",
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
              ctx.assert(await evaluate(client, "!document.querySelector('[data-view=accounts], #view-accounts')"), "Account module remains");
              await evaluate(client, "document.querySelector('#add-account').click()");
              await waitForFrame(client, "document.querySelector('#account-dialog').open", "Douyin add dialog");
              await evaluate(client, "document.querySelector('#close-account-dialog').click()");
              ctx.assert(await evaluate(client, "!document.querySelector('#account-dialog').open && !document.querySelector('#view-studio').hidden"), "Closing add dialog left studio");
              await evaluate(client, "document.querySelector('#add-account').click()");
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
              requireText: ["抖音运营台", "添加抖音账号", "保存应用配置"],
              rejectText: ["Something went wrong"],
            },
          });
        } finally {
          await evaluate(client, "document.querySelector('#account-dialog')?.close()").catch(() => {});
          client.close();
        }
      },
    },
  ],
};
