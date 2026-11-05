const PLUGIN_ID = "wechat-channels-ops";
const PLUGIN_NAME = "视频号运营台";
const VERSION = "0.1.11";

export default {
  id: "wechat-channels-publish-entry",
  title: "WeChat Channels publication reuses the plugin account browser",
  kind: "user-facing",
  preserveTheme: true,
  steps: [
    {
      name: "Install the fixed plugin and verify its account-scoped console target",
      run: async (ctx) => {
        let proof;
        await ctx.prove("视频号自动发布使用已安装插件的账号专属后台入口", {
          voiceover: "视频号运营台更新后，三个 AI 引擎都会把生成的视频交给同一个账号专属后台继续发布。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)");
            proof = await ctx.eval(`(async () => {
              const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
              const workspaceId = localStorage.getItem('ipollowork.react.activeWorkspace')
                || location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || '';
              const headers = {
                authorization: 'Bearer ' + (info.ownerToken || info.clientToken),
                'X-iPolloWork-Host-Token': info.hostToken,
                'content-type': 'application/json',
              };
              const installResponse = await fetch(info.baseUrl + '/workspace/' + workspaceId
                + '/plugin-packages/catalog/${PLUGIN_ID}/install', { method: 'POST', headers, body: '{}' });
              if (!installResponse.ok) throw new Error('Plugin install HTTP ' + installResponse.status);
              const installedResponse = await fetch(info.baseUrl + '/workspace/' + workspaceId + '/plugin-packages', { headers });
              if (!installedResponse.ok) throw new Error('Installed plugins HTTP ' + installedResponse.status);
              const installed = (await installedResponse.json()).items.find((item) => item.pluginId === '${PLUGIN_ID}');
              const sessionId = location.hash.match(/\\/session\\/([^/?]+)/)?.[1] || '';
              const call = async (action, args) => {
                const response = await fetch(info.baseUrl + '/experimental/extensions/call', {
                  method: 'POST', headers,
                  body: JSON.stringify({ extensionId: '${PLUGIN_ID}', action, args, context: { workspaceId, sessionId } }),
                });
                const payload = await response.json();
                if (!response.ok || payload.ok === false) throw new Error(payload?.message || ('Extension HTTP ' + response.status));
                return payload.result;
              };
              const state = await call('studio-state', {});
              const accounts = state.accounts || [];
              const verified = accounts.filter((item) => item.status === 'verified');
              const recoverable = accounts.filter((item) => !['conflict', 'mismatch'].includes(item.status || ''));
              const account = verified.length === 1
                ? verified[0]
                : verified.length === 0 && recoverable.length === 1 ? recoverable[0] : null;
              const target = account ? await call('browser-target', { accountId: account.id }) : null;
              return {
                installedVersion: installed?.version || '',
                accountCount: accounts.length,
                accountStatuses: accounts.map((item) => item.status || 'unknown'),
                selectedAccountStatus: account?.status || '',
                browserTargetUrl: target?.url || '',
                profileScoped: Boolean(target?.profileId?.startsWith('${PLUGIN_ID}:')),
              };
            })()`, { awaitPromise: true });

            const workspaceId = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace') || ''");
            await ctx.navigateHash(`/workspace/${workspaceId}/settings/extensions`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-library-heading"]'))
              || [...document.querySelectorAll('button')].some((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() || ''))`, {
              timeoutMs: 30_000,
              label: "plugin catalog",
            });
            await ctx.eval(`(() => {
              const pluginTab = [...document.querySelectorAll('button, [role="tab"]')]
                .find((entry) => ['插件', 'Plugins'].includes(entry.textContent?.trim() || ''));
              pluginTab?.click();
              const personal = [...document.querySelectorAll('button')]
                .find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() || ''));
              personal?.click();
              const refresh = [...document.querySelectorAll('button')]
                .find((entry) => ['刷新', 'Refresh'].includes(entry.textContent?.trim() || ''));
              refresh?.click();
            })()`);
            await ctx.waitFor(`(() => {
              const row = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')]
                .find((entry) => entry.innerText.includes(${JSON.stringify(PLUGIN_NAME)}));
              row?.scrollIntoView({ block: 'center' });
              return Boolean(row);
            })()`, { timeoutMs: 60_000, label: "WeChat Channels plugin card" });
          },
          assert: async () => {
            ctx.assert(proof?.installedVersion === VERSION, `Installed version was ${proof?.installedVersion || "missing"}`);
            ctx.assert(Boolean(proof?.selectedAccountStatus), `The plugin has no unique verified or recoverable account: ${JSON.stringify(proof?.accountStatuses || [])}`);
            ctx.assert(proof?.browserTargetUrl === "https://channels.weixin.qq.com/platform/", `Unexpected browser target ${proof?.browserTargetUrl || "missing"}`);
            ctx.assert(proof?.profileScoped === true, "The browser target was not scoped to the plugin account profile");
            await ctx.output("wechat-channels-publish-entry", JSON.stringify(proof, null, 2));
          },
          screenshot: {
            name: "wechat-channels-publish-entry",
            requireText: [PLUGIN_NAME],
            rejectText: ["Something went wrong", "本地插件包未生成"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
  ],
};
