const WORKSPACE_ID = "ws_ae63678973e4";
const SESSION_ID = "01a0e6f8-1e27-7e91-97b9-dadab87867ae";
const REQUEST = "给我做一个iPolloWork的介绍短视频并发布到微信视频号";

export default {
  id: "wechat-channels-one-command-delivery",
  title: "One command completes a WeChat Channels video delivery",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "localhost:5173" },
  steps: [{
    name: "The completed task keeps internal continuations hidden and has a durable submitted receipt",
    run: async (ctx) => {
      let transcript;
      let receipt;
      let topOfTranscript;
      await ctx.prove("一条用户需求自动完成视频制作、导出和视频号提交", {
        voiceover: "一条需求已经自动完成视频制作、校验、导出和视频号提交；内部修复没有伪装成新的用户消息，运营台任务也保存为已提交。",
        action: async () => {
          await ctx.waitFor("Boolean(window.__ipolloworkControl)");
          await ctx.navigateHash(`/workspace/${WORKSPACE_ID}/session/${SESSION_ID}`);
          await ctx.waitFor(`location.hash.includes(${JSON.stringify(SESSION_ID)})`, {
            timeoutMs: 30_000,
            label: "completed WeChat Channels task",
          });
          await ctx.control("session.scroll_top");
          await ctx.waitFor(`document.querySelector('[data-testid="session-message-scroll"]')?.innerText.includes(${JSON.stringify(REQUEST)})`, {
            timeoutMs: 30_000,
            label: "original visible user request",
          });
          topOfTranscript = await ctx.eval(`(() => {
            const text = document.querySelector('[data-testid="session-message-scroll"]')?.innerText || '';
            return {
              requestCount: text.split(${JSON.stringify(REQUEST)}).length - 1,
              leakedContinuation: /Continue the unfinished|Apply every application instruction/.test(text),
            };
          })()`);
          await ctx.control("session.scroll_bottom");
          await ctx.waitFor(`document.body.innerText.includes("已完成发布提交。")`, {
            timeoutMs: 30_000,
            label: "accepted WeChat Channels receipt",
          });
        },
        assert: async () => {
          transcript = await ctx.control("session.read_transcript", { count: 30 });
          const messages = transcript?.messages ?? [];
          ctx.assert(topOfTranscript.requestCount >= 1, "The original user request is missing from the completed task");
          ctx.assert(topOfTranscript.leakedContinuation === false, "A host continuation leaked near the original user request");
          ctx.assert(!messages.some((message) => message.role === "user" && /Continue the unfinished|Apply every application instruction/.test(message.text)), "A host continuation leaked into the visible user transcript");
          ctx.assert(messages.some((message) => message.role === "assistant" && message.text.includes("已完成发布提交")), "The accepted publication receipt is missing");

          receipt = await ctx.eval(`(async () => {
            const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
            const headers = {
              authorization: 'Bearer ' + (info.ownerToken || info.clientToken),
              'X-iPolloWork-Host-Token': info.hostToken,
              'content-type': 'application/json',
            };
            const response = await fetch(info.baseUrl + '/experimental/extensions/call', {
              method: 'POST', headers,
              body: JSON.stringify({
                extensionId: 'wechat-channels-ops', action: 'studio-state', args: {},
                context: { workspaceId: ${JSON.stringify(WORKSPACE_ID)}, sessionId: ${JSON.stringify(SESSION_ID)} },
              }),
            });
            const payload = await response.json();
            if (!response.ok || payload.ok === false) throw new Error(payload?.message || ('Extension HTTP ' + response.status));
            const state = payload.result || {};
            const jobs = Array.isArray(state.jobs) ? state.jobs : [];
            const job = jobs.findLast((entry) => entry?.operationKey?.includes(${JSON.stringify(SESSION_ID)}) && entry?.type === 'publish');
            const assets = Array.isArray(state.assets) ? state.assets : [];
            const asset = assets.find((entry) => entry?.id === job?.payload?.assetId);
            return {
              jobStatus: job?.status || '',
              hasVideoAsset: asset?.kind === 'video',
              hasDraft: Array.isArray(state.drafts) && state.drafts.some((entry) => entry?.id === job?.payload?.draftId),
            };
          })()`, { awaitPromise: true });
          ctx.assert(receipt.jobStatus === "submitted", `Publisher job status was ${receipt.jobStatus || "missing"}`);
          ctx.assert(receipt.hasVideoAsset === true, "The submitted job has no imported video asset");
          ctx.assert(receipt.hasDraft === true, "The submitted job has no saved draft");
          await ctx.output("wechat-channels-one-command-delivery", JSON.stringify(receipt, null, 2));
        },
        screenshot: {
          name: "wechat-channels-one-command-delivery",
          requireText: ["已完成发布提交", "submitted"],
          rejectText: ["Continue the unfinished video delivery.", "本次任务未完成"],
          hashIncludes: `/workspace/${WORKSPACE_ID}/session/${SESSION_ID}`,
        },
      });
    },
  }],
};
