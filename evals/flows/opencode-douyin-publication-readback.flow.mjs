export default {
  id: "opencode-douyin-publication-readback",
  title: "OpenCode video export and Douyin publication readback",
  kind: "user-facing",
  requiredEnv: [
    "IPOLLOWORK_EVAL_WORKSPACE_ID",
    "IPOLLOWORK_EVAL_SESSION_ID",
    "IPOLLOWORK_EVAL_PUBLICATION_OPERATION_KEY",
  ],
  steps: [{
    name: "Published OpenCode task shows the platform receipt and its studio tab",
    run: async (ctx) => {
      const workspaceId = ctx.env.IPOLLOWORK_EVAL_WORKSPACE_ID;
      const sessionId = ctx.env.IPOLLOWORK_EVAL_SESSION_ID;
      const operationKey = ctx.env.IPOLLOWORK_EVAL_PUBLICATION_OPERATION_KEY;
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { label: "iPolloWork ready" });
      await ctx.prove("The published video has a real Douyin receipt in its own task", {
        voiceover: "The OpenCode task now shows its published video result, while the Douyin studio remains available in this task's right panel.",
        action: async () => {
          await ctx.control("session.open", { sessionId });
          await ctx.waitFor("document.body.innerText.includes('已完成抖音发布') && document.body.innerText.includes('抖音运营台')", {
            timeoutMs: 30_000,
            label: "published task and Douyin studio tab",
          });
        },
        assert: async () => {
          const state = await ctx.eval(`(async () => {
            const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
            const headers = {
              authorization: 'Bearer ' + (info.ownerToken || info.clientToken),
              'X-iPolloWork-Host-Token': info.hostToken,
              'content-type': 'application/json',
            };
            const response = await fetch(info.baseUrl + '/experimental/extensions/call', {
              method: 'POST', headers,
              body: JSON.stringify({ extensionId: 'douyin-ops', action: 'studio-state', args: {},
                context: { workspaceId: ${JSON.stringify(workspaceId)}, sessionId: ${JSON.stringify(sessionId)} } }),
            });
            const envelope = await response.json();
            const output = envelope.result?.output || envelope.result;
            const job = output?.jobs?.find((item) => item.operationKey === ${JSON.stringify(operationKey + ":douyin-publish")});
            return { status: job?.status, publicationStatus: job?.result?.publicationStatus,
              hasStudio: Boolean(document.querySelector('iframe[title="抖音运营台"]')) };
          })()`, { awaitPromise: true });
          ctx.assert(state.status === "succeeded", "Douyin studio saved a succeeded publication job");
          ctx.assert(state.publicationStatus === "under_review", "platform readback reports the work under review");
          ctx.assert(state.hasStudio, "this task has its Douyin studio tab mounted");
        },
        screenshot: { name: "opencode-douyin-published", requireText: ["已完成抖音发布", "抖音运营台"] },
      });
    },
  }],
};
