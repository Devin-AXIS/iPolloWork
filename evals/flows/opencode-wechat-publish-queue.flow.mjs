const WORKSPACE_ID = "ws_b018a7cf52ee";
const SESSION_ID = "ses_f0e8c75f8ffeFQKpErjqjo77c9";
const PREVIOUS_JOB_ID = "fb1b4314-2567-4307-a331-0983d2f29194";
const QUEUED_JOB_ID = "99bf2f20-12d7-4bdf-9316-0a605b648a39";
const REQUEST = "给我做一个介绍ipollowork的短视频发布到微信视频号";

export default {
  id: "opencode-wechat-publish-queue",
  title: "OpenCode video delivery preserves a queued WeChat Channels publication",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "localhost:5173" },
  steps: [{
    name: "The failed publication is explicit and the exported video stays queued",
    run: async (ctx) => {
      await ctx.prove("导出成功但视频号结果未确认时，会话明确显示未发布，并保存待发布任务", {
        voiceover: "只发一句需求，视频已经导出；视频号前一笔提交仍待核对，因此当前任务安全排队，并明确显示未完成。",
        action: async () => {
          await ctx.waitFor("Boolean(window.__ipolloworkControl)");
          await ctx.navigateHash(`/workspace/${WORKSPACE_ID}/session/${SESSION_ID}`);
          await ctx.eval(`(() => {
            const scroller = document.querySelector('[data-testid="session-message-scroll"]');
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
          })()`);
          await ctx.waitFor('document.querySelector("[data-assistant-run-error]")?.textContent.includes("上一笔提交结果待核对")', {
            timeoutMs: 30_000,
            label: "objective publication failure",
          });
        },
        assert: async () => {
          const transcript = await ctx.control("session.read_transcript", { count: 30 });
          const userMessages = (transcript?.messages ?? []).filter((message) => message.role === "user");
          ctx.assert(userMessages.length === 1 && userMessages[0].text.trim() === `You\n${REQUEST}`,
            "The acceptance task did not contain exactly the requested user sentence");
          const result = await ctx.eval(`(async () => {
            const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
            const response = await fetch(info.baseUrl + '/experimental/extensions/call', {
              method: 'POST',
              headers: {
                authorization: 'Bearer ' + (info.ownerToken || info.clientToken),
                'X-iPolloWork-Host-Token': info.hostToken,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                extensionId: 'wechat-channels-ops', action: 'studio-state', args: {},
                context: { workspaceId: ${JSON.stringify(WORKSPACE_ID)}, sessionId: ${JSON.stringify(SESSION_ID)} },
              }),
            });
            const payload = await response.json();
            if (!response.ok || payload.ok === false) throw new Error(payload.message || 'Studio state unavailable');
            const state = payload.result || {};
            const earlier = (state.jobs || []).find((job) => job.id === ${JSON.stringify(PREVIOUS_JOB_ID)});
            const queued = (state.jobs || []).find((job) => job.id === ${JSON.stringify(QUEUED_JOB_ID)});
            const draft = (state.drafts || []).find((item) => item.id === queued?.payload?.draftId);
            const asset = (state.assets || []).find((item) => item.id === queued?.payload?.assetId);
            return {
              earlierStatus: earlier?.status || '', queuedStatus: queued?.status || '',
              queuedSessionId: queued?.sessionId || '', hasDraft: Boolean(draft),
              videoAssetKind: asset?.kind || '',
              visibleFailure: document.querySelector('[data-assistant-run-error]')?.textContent.includes('上一笔提交结果待核对'),
              errorCards: document.querySelectorAll('[data-testid="run-issue-notice"]').length,
              errorInReply: Boolean(document.querySelector('[data-assistant-result] [data-assistant-run-error]')),
            };
          })()`, { awaitPromise: true });
          ctx.assert(result.earlierStatus === "uncertain", `Earlier job was ${result.earlierStatus}`);
          ctx.assert(result.queuedStatus === "prepared", `Current job was ${result.queuedStatus}`);
          ctx.assert(result.queuedSessionId === SESSION_ID, "Queued job lost its conversation ownership");
          ctx.assert(result.hasDraft && result.videoAssetKind === "video", "Rendered video or draft was not preserved");
          ctx.assert(result.visibleFailure, "The failure detail is not visible in the conversation");
          ctx.assert(result.errorCards === 0 && result.errorInReply, "The error should be reply text, not a separate card");
          await ctx.output("opencode-wechat-publish-queue", JSON.stringify(result, null, 2));
        },
        screenshot: {
          name: "opencode-wechat-publish-queue",
          requireText: ["本次任务未完成", "上一笔提交结果待核对"],
          hashIncludes: `/workspace/${WORKSPACE_ID}/session/${SESSION_ID}`,
        },
      });
    },
  }],
};
