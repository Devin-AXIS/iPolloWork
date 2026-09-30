import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

function sessionFromRoute(route) {
  const match = /session\/([^/?#]+)/.exec(route);
  return match ? decodeURIComponent(match[1]) : null;
}

async function browserTargetEval(ctx, urlMarker, expression) {
  const deadline = Date.now() + 20_000;
  let target;
  while (Date.now() < deadline) {
    target = (await listTargets(ctx.cdpBaseUrl)).find((item) =>
      item.webSocketDebuggerUrl && item.url.includes(urlMarker));
    if (target) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  ctx.assert(target, `Browser target ${urlMarker} was not available`);
  const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
  try {
    return await evaluate(client, expression, { awaitPromise: true });
  } finally {
    client.close();
  }
}

async function waitForOwnedTab(ctx, ownedTabId, foreignTabId) {
  return ctx.waitFor(`(() => {
    const owned = document.getElementById(${JSON.stringify(ownedTabId)});
    const foreign = document.getElementById(${JSON.stringify(foreignTabId)});
    return Boolean(owned?.querySelector('button[aria-label^="Select tab:"]')) && !foreign;
  })()`, { timeoutMs: 30_000, label: `only owned tab ${ownedTabId} is visible` });
}

export default {
  id: "session-browser-tab-isolation",
  title: "Conversation browser tabs are isolated while account cache is shared",
  kind: "user-facing",
  steps: [{
    name: "Two tasks keep independent right-panel tabs and reuse one account cache",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "control API" });
      await ctx.waitFor("window.__ipolloworkControl.listActions().some((item) => item.id === 'session.create_task' && !item.disabled)", {
        timeoutMs: 60_000,
        label: "task creation",
      });
      await ctx.eval("window.__IPOLLOWORK_ELECTRON__.browser.closeAllTabs?.()", { awaitPromise: true });

      await ctx.control("session.create_task");
      const routeA = await ctx.waitFor(`(() => {
        const route = window.__ipolloworkControl.snapshot().route;
        return new RegExp('session/[^/?#]+').test(route) ? route : null;
      })()`, { timeoutMs: 30_000, label: "first task route" });
      const sessionA = sessionFromRoute(routeA);
      ctx.assert(sessionA, "First task ID is missing");
      const openedA = await ctx.eval(`window.__IPOLLOWORK_ELECTRON__.browser.openUrl(
        'https://example.com/?ipw-tab-isolation=a',
        { profileId: 'fraimz:shared-social-account', taskId: ${JSON.stringify(sessionA)} }
      )`, { awaitPromise: true });
      await browserTargetEval(ctx, "ipw-tab-isolation=a", `(() => {
        localStorage.setItem('ipw-shared-account-cache', 'ready');
        document.cookie = 'ipw_shared_account=ready; path=/';
        document.title = 'Task A account cache';
        return true;
      })()`);

      await ctx.control("session.create_task");
      const routeB = await ctx.waitFor(`(() => {
        const route = window.__ipolloworkControl.snapshot().route;
        return route !== ${JSON.stringify(routeA)} && new RegExp('session/[^/?#]+').test(route) ? route : null;
      })()`, { timeoutMs: 30_000, label: "second task route" });
      const sessionB = sessionFromRoute(routeB);
      ctx.assert(sessionB, "Second task ID is missing");
      const openedB = await ctx.eval(`window.__IPOLLOWORK_ELECTRON__.browser.openUrl(
        'https://example.com/?ipw-tab-isolation=b',
        { profileId: 'fraimz:shared-social-account', taskId: ${JSON.stringify(sessionB)} }
      )`, { awaitPromise: true });
      await browserTargetEval(ctx, "ipw-tab-isolation=b", "document.title = 'Task B account cache'; true");

      await ctx.prove("The current task shows only its own right-panel browser tab", {
        voiceover: "两个任务分别拥有自己的右侧标签；切到第二个任务时，只会看到第二个任务的页面。",
        action: async () => {
          await waitForOwnedTab(ctx, openedB.tabId, openedA.tabId);
        },
        assert: async () => {
          const state = await ctx.eval("window.__IPOLLOWORK_ELECTRON__.browser.getState()", { awaitPromise: true });
          const first = state.tabs.find((tab) => tab.id === openedA.tabId);
          const second = state.tabs.find((tab) => tab.id === openedB.tabId);
          ctx.assert(first?.sessionId === sessionA && second?.sessionId === sessionB, JSON.stringify(state.tabs));
          ctx.assert(first?.profileId === second?.profileId, "The account profile cache must stay shared");
        },
        screenshot: {
          name: "second-task-own-tab",
          requireText: ["Task B account cache"],
          hashIncludes: `/session/${sessionB}`,
        },
      });

      await ctx.prove("Switching back restores the first task tab and the shared account cache", {
        voiceover: "切回第一个任务后，它原来的标签会恢复，同时两个任务仍然复用同一份账号登录缓存。",
        action: async () => {
          await ctx.navigateHash(routeA);
          await waitForOwnedTab(ctx, openedA.tabId, openedB.tabId);
        },
        assert: async () => {
          const shared = await browserTargetEval(ctx, "ipw-tab-isolation=b", `[
            localStorage.getItem('ipw-shared-account-cache'),
            document.cookie.includes('ipw_shared_account=ready')
          ]`);
          ctx.assert(shared[0] === "ready" && shared[1] === true, `Shared cache was not reused: ${JSON.stringify(shared)}`);
        },
        screenshot: {
          name: "first-task-tab-restored",
          requireText: ["Task A account cache"],
          hashIncludes: `/session/${sessionA}`,
        },
      });
    },
  }],
};
