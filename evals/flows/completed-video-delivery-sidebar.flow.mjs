export default {
  id: "completed-video-delivery-sidebar",
  title: "Completed video publication releases its sidebar activity",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_WORKSPACE_ID", "IPOLLOWORK_EVAL_SESSION_ID"],
  steps: [{
    name: "Published video task is no longer processing",
    run: async (ctx) => {
      const workspaceId = ctx.env.IPOLLOWORK_EVAL_WORKSPACE_ID;
      const sessionId = ctx.env.IPOLLOWORK_EVAL_SESSION_ID;
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { label: "iPolloWork ready" });
      await ctx.prove("The published Codex task has no sidebar spinner", {
        voiceover: "The video is published, and its completed task no longer appears to be processing in the sidebar.",
        action: async () => {
          await ctx.control("session.open", { sessionId });
          await ctx.waitFor("document.body.innerText.includes('视频已成功发布到微信视频号')", {
            timeoutMs: 30_000,
            label: "published WeChat Channels result",
          });
        },
        assert: async () => {
          const state = await ctx.eval(`(async () => {
            const workspaceId = ${JSON.stringify(workspaceId)};
            const sessionId = ${JSON.stringify(sessionId)};
            const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
            const headers = {
              authorization: 'Bearer ' + (info.ownerToken || info.clientToken),
              'X-iPolloWork-Host-Token': info.hostToken,
              'content-type': 'application/json',
            };
            const snapshotResponse = await fetch(info.baseUrl + '/workspace/' + workspaceId + '/sessions/' + sessionId + '/snapshot', { headers });
            const snapshot = await snapshotResponse.json();
            const studioResponse = await fetch(info.baseUrl + '/experimental/extensions/call', {
              method: 'POST', headers,
              body: JSON.stringify({ extensionId: 'wechat-channels-ops', action: 'studio-state', args: {},
                context: { workspaceId, sessionId } }),
            });
            const envelope = await studioResponse.json();
            const output = envelope.result?.output || envelope.result;
            const publication = output?.jobs?.find(job => job.operationKey?.startsWith('ipw:' + sessionId + ':')
              && job.operationKey?.endsWith(':wechat-channels-publish'));
            const row = [...document.querySelectorAll('span[title]')].find(node =>
              node.title === '给我做一个介绍ipollowork的短视频发布到微信视频号'
              && node.closest('[data-sidebar="group"]')?.innerText.trim().startsWith('codex'));
            return {
              engineStatus: snapshot.item?.status?.type,
              publicationStatus: publication?.status,
              rowFound: Boolean(row),
              sidebarProcessing: Boolean(row?.closest('li')?.querySelector('svg.animate-spin')),
            };
          })()`, { awaitPromise: true });
          ctx.assert(state.engineStatus === "idle", "Codex engine turn has finished");
          ctx.assert(state.publicationStatus === "published", "WeChat Channels publish job succeeded");
          ctx.assert(state.rowFound, "the completed Codex task is visible in the sidebar");
          ctx.assert(!state.sidebarProcessing, "the completed task has no processing spinner");
        },
        screenshot: { name: "published-task-sidebar-idle", requireText: ["视频已成功发布到微信视频号", "codex"] },
      });
    },
  }],
};
