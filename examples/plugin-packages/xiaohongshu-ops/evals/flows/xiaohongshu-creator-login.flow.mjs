import { connect, listTargets } from "../run.mjs";

const frame = `document.querySelector('iframe[title="小红书运营台"]')`;
const entry = `document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]')`;

export default {
  id: "xiaohongshu-creator-login",
  title: "小红书接入新账号直接显示独立扫码页",
  kind: "user-facing",
  steps: [{
    name: "接入账号后显示官方二维码，重复打开保留扫码进度",
    async run(ctx) {
      if (!await ctx.eval(`Boolean(${frame})`)) {
        if (!await ctx.eval(`Boolean(${entry})`)) await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]').click()`);
        await ctx.waitFor(`Boolean(${entry})`);
        await ctx.eval(`${entry}.click()`);
      }
      await ctx.waitFor(`Boolean(${frame}?.src)`);
      const origin = new URL(await ctx.eval(`${frame}.src`)).origin;
      const target = (await listTargets(ctx.cdpBaseUrl)).find(value => value.type === "iframe" && value.url.startsWith(origin + "/"));
      ctx.assert(Boolean(target), "The workbench iframe is missing.");
      const client = await connect(target.webSocketDebuggerUrl);
      const evaluate = async expression => {
        const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        ctx.assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description || "Frame script failed.");
        return result.result.value;
      };
      try {
        if (await evaluate(`location.pathname !== '/accounts'`)) await evaluate(`document.querySelector('a[href="/accounts"]').click()`);
        for (let attempt = 0; attempt < 40; attempt++) {
          if (await evaluate(`Boolean(document.querySelector('[data-open-account-form]'))`)) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        await ctx.prove("点击接入账号，直接显示独立的小红书扫码登录页", {
          voiceover: "点击接入账号，软件直接打开小红书二维码，无需退出已有账号；重复打开同一次接入会保留扫码进度。",
          action: () => evaluate(`document.querySelector('[data-open-account-form]').click()`),
          assert: async () => {
            let state;
            for (let attempt = 0; attempt < 100; attempt++) {
              state = await ctx.eval(`window.__IPOLLOWORK_ELECTRON__.browser.getState()`, { awaitPromise: true });
              if (state.tabs?.some(t => t.id === state.activeTabId && t.profileId?.startsWith('xiaohongshu-ops:') && t.url.startsWith('https://creator.xiaohongshu.com/login') && t.status === 'ready')) break;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            const loginTab = state.tabs.find(tab => tab.id === state.activeTabId);
            const loginTarget = (await listTargets(ctx.cdpBaseUrl)).find(tab => tab.url.startsWith("https://creator.xiaohongshu.com/login"));
            ctx.assert(Boolean(loginTarget), "Official login page is missing.");
            const loginClient = await connect(loginTarget.webSocketDebuggerUrl);
            try {
              let qr = false;
              for (let attempt = 0; attempt < 50; attempt++) {
                const result = await loginClient.send("Runtime.evaluate", { expression: `document.body.innerText.includes('APP扫一扫登录')&&Array.from(document.images).some(img=>img.complete&&img.naturalWidth>=140&&img.getBoundingClientRect().width>=140&&img.getBoundingClientRect().width<=300)`, returnByValue: true });
                if (result.result.value) { qr = true; break; }
                await new Promise(resolve => setTimeout(resolve, 200));
              }
              ctx.assert(qr, "The official QR code has not rendered.");
            } finally { loginClient.close(); }
            await evaluate(`document.querySelector('[data-new-account-login]').click()`);
            await new Promise(resolve => setTimeout(resolve, 300));
            const after = await ctx.eval(`window.__IPOLLOWORK_ELECTRON__.browser.getState()`, { awaitPromise: true });
            ctx.assert(after.activeTabId === loginTab.id && after.tabs.length === state.tabs.length, "Reopening discarded the current login page.");
            ctx.assert(await evaluate(`Boolean(document.querySelector('#account-onboarding:not([hidden])'))`), "The account form was lost.");
          },
          screenshot: { name: "isolated-creator-qr-login", fromSurface: false, textTargetUrlIncludes: "creator.xiaohongshu.com/login", requireText: ["扫码"] },
        });
      } finally { client.close(); }
    },
  }],
};
