import { mountFixture } from "./conversation-streaming-result.flow.mjs";

const startedAt = Date.UTC(2026, 10, 10, 10, 18, 47);
const completedAt = startedAt + 3_455_000;
const reopenedAt = completedAt + 21 * 3_600_000 + 40 * 60_000;
const messages = [
  { id: "elapsed-user", role: "user", metadata: { ipollowork: { created: startedAt } }, parts: [{ type: "text", text: "请检查项目资料。" }] },
  { id: "elapsed-reply", role: "assistant", metadata: { ipollowork: { completed: completedAt } }, parts: [{ type: "text", text: "项目资料已核对完成。", state: "done" }] },
];
const state = "document.querySelector('#streaming-answer-proof [data-testid=assistant-current-state]')";

async function show(ctx, messageListProps) {
  await ctx.eval(`(${mountFixture.toString()})(${JSON.stringify({ messageListProps })})`, { awaitPromise: true });
}

export default {
  id: "conversation-elapsed-time",
  title: "A reopened conversation shows how long its task ran",
  kind: "user-facing",
  steps: [{
    name: "Read the elapsed time after reopening",
    run: async (ctx) => {
      try {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)");
        await show(ctx, { messages, status: "ready", runOutcome: "stopped", runEndedAt: completedAt + 20_000 });
        await ctx.waitFor(`${state}?.textContent.includes('已停止') && ${state}?.textContent.includes('57分钟 55秒')`);

        await show(ctx, {
          messages: [{ ...messages[0], metadata: { ipollowork: { created: Date.now() - 5_000 } } }],
          status: "streaming", runOutcome: "running",
        });
        await ctx.waitFor(`${state}?.textContent.includes('已用时')`);
        const initial = await ctx.eval(`${state}.textContent`);
        await ctx.waitFor(`${state}?.textContent.includes('已用时') && ${state}.textContent !== ${JSON.stringify(initial)}`);

        await ctx.prove("An overnight reopen keeps the original task duration", {
          voiceover: "第二天重新打开这条会话，已完成任务仍显示用时 57 分钟 35 秒。",
          action: () => show(ctx, {
            messages, status: "ready", runOutcome: "completed", runEndedAt: reopenedAt,
            runTimings: { "elapsed-user": { startedAt, endedAt: reopenedAt } },
          }),
          assert: async () => {
            await ctx.waitFor(`${state}?.textContent.includes('已完成 · 用时 57分钟 35秒')`);
            ctx.assert(await ctx.eval(`${state}.closest('button').dataset.activeStatus === 'false'`), "The completed task no longer ticks");
          },
          screenshot: { name: "reopened-duration", requireText: ["用时 57分钟 35秒"], rejectText: ["22小时"] },
        });
      } finally {
        await ctx.eval("window.__streamingAnswerProof?.cleanup?.()");
      }
    },
  }],
};
