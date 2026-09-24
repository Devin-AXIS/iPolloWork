import { connect, evaluate, listTargets } from "../runner/cdp.mjs";

const PLUGIN_ID = "wechat-channels-ops";
const PLUGIN_NAME = "视频号运营台";
const VERSION = "0.1.7";

export default {
  id: "wechat-channels-ops",
  title: "Install WeChat Channels Operations and open account management",
  kind: "user-facing",
  preserveTheme: true,
  steps: [
    {
      name: "Install from the bundled plugin collection",
      run: async (ctx) => {
        await ctx.prove("视频号运营台可从主软件插件集安装", {
          voiceover: "视频号运营台已经加入个人插件列表，用户可以直接安装，不需要选择外部插件包。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)");
            const workspaceId = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace') || ''");
            ctx.assert(workspaceId, "An active workspace is required for the plugin catalog");
            await ctx.navigateHash(`/workspace/${workspaceId}/settings/extensions`);
            await ctx.waitFor(`[...document.querySelectorAll('button')]
              .some((entry) => ["刷新", "Refresh"].includes(entry.textContent?.trim() ?? ""))`, { timeoutMs: 30_000 });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-library-heading"]'))
              || [...document.querySelectorAll('button')]
                .some((entry) => ["个人", "Personal"].includes(entry.textContent?.trim() ?? ""))`, {
              timeoutMs: 30_000,
              label: "personal extension source",
            });
            await ctx.eval(`(() => {
              const pluginTab = [...document.querySelectorAll('button, [role="tab"]')]
                .find((entry) => ["插件", "Plugins"].includes(entry.textContent?.trim() ?? ""));
              pluginTab?.click();
              const personalScope = [...document.querySelectorAll('button')]
                .find((entry) => ["个人", "Personal"].includes(entry.textContent?.trim() ?? ""));
              personalScope?.click();
              const refresh = [...document.querySelectorAll('button')]
                .find((entry) => ["刷新", "Refresh"].includes(entry.textContent?.trim() ?? ""));
              refresh?.click();
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-library-heading"]'))`, {
              timeoutMs: 30_000,
              label: "personal plugin library",
            });
            await ctx.waitFor(`(() => [...document.querySelectorAll('[data-testid="plugin-package-list-item"], button')]
              .some((row) => row.innerText.includes(${JSON.stringify(PLUGIN_NAME)})))()`, {
              timeoutMs: 60_000,
              label: "WeChat Channels catalog card",
            });
            const installedVersion = await ctx.eval(`(async () => {
              const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
              const workspaceId = localStorage.getItem('ipollowork.react.activeWorkspace') || '';
              const response = await fetch(info.baseUrl + '/workspace/' + workspaceId + '/plugin-packages', {
                headers: { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken },
              });
              if (!response.ok) return '';
              return (await response.json()).items.find((item) => item.pluginId === ${JSON.stringify(PLUGIN_ID)})?.version ?? '';
            })()`, { awaitPromise: true });
            if (installedVersion !== VERSION) {
              await ctx.waitFor(`(() => [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')]
                .filter((entry) => entry.innerText.includes(${JSON.stringify(PLUGIN_NAME)}))
                .flatMap((row) => [...row.querySelectorAll('button')])
                .some((entry) => ["安装", "Install", "更新", "Update"].includes(entry.innerText?.trim() ?? "")))()`, {
                timeoutMs: 60_000,
                label: "WeChat Channels install or update button",
              });
              const clickedInstall = await ctx.eval(`(() => {
                const button = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')]
                  .filter((entry) => entry.innerText.includes(${JSON.stringify(PLUGIN_NAME)}))
                  .flatMap((row) => [...row.querySelectorAll('button')])
                  .find((entry) => ["安装", "Install", "更新", "Update"].includes(entry.innerText?.trim() ?? ""));
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(clickedInstall, "WeChat Channels install or update button was not clickable");
              let updated = false;
              for (let attempt = 0; attempt < 120; attempt += 1) {
                updated = await ctx.eval(`(async () => {
                  const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
                  const workspaceId = localStorage.getItem('ipollowork.react.activeWorkspace') || '';
                  const response = await fetch(info.baseUrl + '/workspace/' + workspaceId + '/plugin-packages', {
                    headers: { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken },
                  });
                  if (!response.ok) return false;
                  return (await response.json()).items.some((item) => item.pluginId === ${JSON.stringify(PLUGIN_ID)} && item.version === ${JSON.stringify(VERSION)});
                })()`, { awaitPromise: true });
                if (updated) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              ctx.assert(updated, "WeChat Channels update did not finish");
            }
          },
          assert: async () => {
            const installed = await ctx.eval(`(async () => {
              const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
              const workspaceId = localStorage.getItem('ipollowork.react.activeWorkspace') || '';
              const response = await fetch(info.baseUrl + '/workspace/' + workspaceId + '/plugin-packages', {
                headers: { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken },
              });
              if (!response.ok) throw new Error('Installed packages HTTP ' + response.status);
              return (await response.json()).items.find((item) => item.pluginId === ${JSON.stringify(PLUGIN_ID)});
            })()`, { awaitPromise: true });
            ctx.assert(installed?.version === VERSION, `Installed version was ${installed?.version ?? "missing"}`);
            ctx.assert(installed?.manifest?.source?.origin === "builtin", "Installed package was not sourced from the bundled catalog");
            await ctx.output("wechat-channels-installed", JSON.stringify(installed, null, 2));
          },
          screenshot: {
            name: "wechat-channels-installed",
            requireText: [PLUGIN_NAME],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Open the workbench and account dialog",
      run: async (ctx) => {
        const entrySelector = `[data-testid="side-panel-launcher-workspace-app:${PLUGIN_ID}:workspace-app:workbench"]`;
        const frameSelector = `iframe[title="${PLUGIN_NAME}"]`;
        const sessionRoute = await ctx.eval(`(async () => {
          const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
          const workspaceId = localStorage.getItem('ipollowork.react.activeWorkspace') || '';
          const response = await fetch(info.baseUrl + '/workspace/' + workspaceId + '/sessions?limit=1', {
            headers: { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken },
          });
          if (!response.ok) throw new Error('Sessions HTTP ' + response.status);
          const sessionId = (await response.json()).items?.[0]?.id || '';
          if (!sessionId) throw new Error('No session is available for side-panel verification');
          return '/workspace/' + workspaceId + '/session/' + sessionId;
        })()`, { awaitPromise: true });
        await ctx.navigateHash(sessionRoute);
        await ctx.waitFor(`Boolean([...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === ${JSON.stringify(PLUGIN_NAME)} && entry.getAttribute('aria-label')?.startsWith('Select tab:'))
          || document.querySelector('[data-testid="right-panel-toggle"]') || document.querySelector('[aria-label="添加侧面板入口"]'))`, { timeoutMs: 30_000 });
        const selectedExisting = await ctx.eval(`(() => {
          const tab = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === ${JSON.stringify(PLUGIN_NAME)}
            && entry.getAttribute('aria-label')?.startsWith('Select tab:'));
          tab?.click();
          return Boolean(tab);
        })()`);
        if (!selectedExisting) {
          if (!await ctx.eval(`Boolean(document.querySelector('[aria-label="添加侧面板入口"]'))`)) {
            await ctx.eval(`document.querySelector('[data-testid="right-panel-toggle"]')?.click()`);
          }
          await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"添加侧面板入口\"]'))", { timeoutMs: 30_000 });
          if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(entrySelector)}))`)) {
            await ctx.eval("document.querySelector('[aria-label=\"添加侧面板入口\"]')?.click()");
          }
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(entrySelector)}))`, { timeoutMs: 30_000 });
          await ctx.eval(`document.querySelector(${JSON.stringify(entrySelector)}).click()`);
        }
        await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(frameSelector)})?.src)`, { timeoutMs: 60_000 });
        const origin = new URL(await ctx.eval(`document.querySelector(${JSON.stringify(frameSelector)}).src`)).origin;
        let target;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          target = (await listTargets(ctx.cdpBaseUrl)).find((item) => item.type === "iframe" && item.url.startsWith(`${origin}/`));
          if (target) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        ctx.assert(Boolean(target), "The installed workbench did not create an iframe target");
        const client = await connect(target.webSocketDebuggerUrl);
        try {
          await ctx.prove("主软件内可用弹窗管理视频号账号", {
            voiceover: "从右侧入口打开视频号运营台后，管理账号会在当前工作台弹出，创作页面保持在后方。",
            action: async () => {
              for (let attempt = 0; attempt < 80; attempt += 1) {
                const ready = await evaluate(client, `document.body?.innerText.includes(${JSON.stringify(PLUGIN_NAME)})
                  && document.querySelector('#mode-label')?.textContent === '已连接会话'`);
                if (ready) break;
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
              await evaluate(client, `(() => {
                const button = [...document.querySelectorAll('button')]
                  .find((entry) => entry.textContent?.includes('管理账号'));
                button?.click();
                return Boolean(button);
              })()`);
              for (let attempt = 0; attempt < 40; attempt += 1) {
                if (await evaluate(client, "Boolean(document.querySelector('#accounts-dialog[open]'))")) break;
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
            },
            assert: async () => {
              ctx.assert(await evaluate(client, "Boolean(document.querySelector('#accounts-dialog[open]'))"), "Account management dialog did not open");
              ctx.assert(await evaluate(client, "Boolean(document.querySelector('#start-account-connect') && document.querySelector('#account-connect-panel:not([hidden])'))"), "QR connection controls are missing");
              ctx.assert(await evaluate(client, "document.querySelector('#mode-label')?.textContent === '已连接会话'"), "Workbench did not connect to the host session");
              ctx.assert(await ctx.eval(`document.querySelector(${JSON.stringify(frameSelector)}).getBoundingClientRect().width > 200`), "Workbench iframe is not visible");
            },
            screenshot: {
              name: "wechat-channels-account-dialog",
              textTargetId: target.id,
              requireText: ["账号管理", "扫码添加账号", "微信扫码连接", "自动识别账号"],
              rejectText: ["操作失败", "Something went wrong"],
            },
          });
          await ctx.prove("扫码连接使用账号专属会话并自动恢复登录", {
            voiceover: "点击扫码连接后，运营台会打开账号专属的视频号助手会话。已经扫码的账号会直接恢复后台并自动完成身份核验。",
            action: async () => {
              await ctx.eval(`(async () => {
                const browser = window.__IPOLLOWORK_ELECTRON__?.browser;
                const state = await browser?.getState?.();
                for (const tab of state?.tabs ?? []) {
                  if (tab.url?.startsWith('https://channels.weixin.qq.com/')) await browser.closeTab(tab.id);
                }
              })()`, { awaitPromise: true });
              await evaluate(client, `(() => {
                const reconnect = [...document.querySelectorAll('#accounts-list .record button')]
                  .find((entry) => ['扫码连接', '重新登录'].includes(entry.textContent?.trim() ?? ''));
                (reconnect ?? document.querySelector('#new-account'))?.click();
              })()`);
              let accountTab;
              for (let attempt = 0; attempt < 60; attempt += 1) {
                accountTab = await ctx.eval(`(async () => {
                  const state = await window.__IPOLLOWORK_ELECTRON__?.browser?.getState?.();
                  return state?.tabs?.find((tab) => tab.url?.startsWith('https://channels.weixin.qq.com/')
                    && tab.profileId?.startsWith('${PLUGIN_ID}:')) ?? null;
                })()`, { awaitPromise: true });
                if (accountTab) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              ctx.assert(Boolean(accountTab), "The account-specific WeChat Channels tab did not open");
              for (let attempt = 0; attempt < 40; attempt += 1) {
                if (await evaluate(client, `document.body?.innerText.includes('身份已核验')`)) break;
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
            },
            assert: async () => {
              const browserState = await ctx.eval("window.__IPOLLOWORK_ELECTRON__.browser.getState()", { awaitPromise: true });
              const accountTab = browserState.tabs.find((tab) => tab.url?.startsWith("https://channels.weixin.qq.com/")
                && tab.profileId?.startsWith(`${PLUGIN_ID}:`));
              ctx.assert(Boolean(accountTab), "The QR login tab did not use the account browser profile");
              const accountStatus = await evaluate(client, `({
                waiting: document.body?.innerText.includes('等待微信扫码确认'),
                verified: document.body?.innerText.includes('身份已核验'),
              })`);
              ctx.assert(accountStatus.waiting || accountStatus.verified, "Workbench did not show a connection result");
              await ctx.output("wechat-channels-account-session", JSON.stringify({
                url: accountTab.url,
                profileId: accountTab.profileId,
                status: accountStatus.verified ? "verified" : "waiting-for-scan",
              }, null, 2));
            },
            screenshot: {
              name: "wechat-channels-account-session",
              textTargetId: target.id,
              requireText: ["账号管理", "自动识别账号"],
              rejectText: ["操作失败", "无法打开视频号助手"],
            },
          });
        } finally {
          client.close();
        }
      },
    },
  ],
};
