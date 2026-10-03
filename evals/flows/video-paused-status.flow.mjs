// Run with an already-stopped video conversation open; never starts a model job.
export default {
  id: "video-paused-status", title: "Stopped video editing and separate historical job failures",
  kind: "user-facing", preserveTheme: true,
  steps: [{ name: "Inspect the stopped video conversation", run: async ctx => {
    await ctx.prove("A stopped conversation releases the editing warning and groups previous video failures", {
      voiceover: "停止对话后，视频不再显示 AI 修改中；此前失败的视频任务收进独立历史记录。",
      action: async () => {
        await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"HyperFrames 视频工作室\"]'))");
        await ctx.waitForText("历史视频任务有");
      },
      assert: async () => {
        const idle = await ctx.eval(`(async () => {
          const route = location.hash.split('/');
          if (route[1] !== 'workspace' || route[3] !== 'session') return false;
          const { getReactQueryClient } = await import('/src/react-app/infra/query-client.ts');
          const { statusKey } = await import('/src/react-app/domains/session/sync/session-sync.ts');
          return getReactQueryClient().getQueryData(statusKey(route[2], route[4].split('?')[0]))?.type === 'idle';
        })()`, { awaitPromise: true });
        ctx.assert(idle, "The canonical conversation status is idle");
        ctx.assert(await ctx.eval("[...document.querySelectorAll('[data-video-job-status=failed]')].every(e => e.closest('details') && !e.closest('details').open)"), "Previous failures are collapsed instead of looking like a new conversation error");
        const { frameTree } = await ctx.client.send("Page.getFrameTree");
        const frame = frameTree.childFrames?.find(item => item.frame.urlFragment?.startsWith('#project/'));
        ctx.assert(frame, "Video Studio frame is mounted");
        const { executionContextId } = await ctx.client.send("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "video-paused-proof" });
        const { result } = await ctx.client.send("Runtime.evaluate", { contextId: executionContextId, expression: "document.body.innerText.includes('AI 修改视频中')", returnByValue: true });
        ctx.assert(result.value === false, "The real Studio iframe no longer shows the editing warning");
      },
      screenshot: { name: "paused-video", requireText: ["历史视频任务有"], rejectText: ["iPolloWork 暂时无法响应"] },
    });
  } }],
};
