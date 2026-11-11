async function openReadySession(ctx) {
  const previous = await ctx.eval("location.hash");
  await ctx.control("session.create_task");
  return ctx.waitFor(`(() => {
    if (location.hash === ${JSON.stringify(previous)}) return false;
    const sessionId = location.hash.match(/ses_[A-Za-z0-9]+/)?.[0];
    return sessionId && !document.querySelector('[data-message-role=user]')
      && window.__ipolloworkControl.listActions().some(action => action.id === 'eval.session.seed_error')
      && sessionId;
  })()`, { timeoutMs: 30_000, label: "fresh error recovery conversation" });
}

export default {
  id: "session-error-followup",
  title: "A failed turn does not block or contaminate the next conversation turn",
  kind: "user-facing",
  steps: [
    {
      name: "A terminal error releases the Composer for a new request",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        const sessionId = await openReadySession(ctx);
        const canStop = await ctx.eval(`window.__ipolloworkControl.listActions()
          .some((action) => action.id === "composer.stop" && !action.disabled)`);
        if (canStop) await ctx.control("composer.stop");

        const failedPrompt = `错误边界测试 ${Date.now()}：第一条会失败`;
        const recoveryPrompt = `错误恢复测试 ${Date.now()}。请只回复：恢复成功`;
        const errorText = "Fraimz 模拟错误：当前轮请求失败";

        try {
          await ctx.prove("A failed turn stays visible while the Composer immediately accepts an independent follow-up", {
            voiceover: "这一轮明确报错后，输入框立即恢复，我可以编辑并发送下一条需求。",
            action: async () => {
              await ctx.control("eval.session.seed_error", { prompt: failedPrompt, errorText });
              await ctx.waitFor("document.querySelector('[data-assistant-run-error]')?.innerText.includes('可以重试或继续发送消息')", { timeoutMs:10_000 });
              await ctx.control("composer.set_text", { text: recoveryPrompt });
              await ctx.waitFor(`window.__ipolloworkControl.listActions()
                .some((action) => action.id === "composer.send" && !action.disabled)`, {
                timeoutMs: 10_000,
                label: "follow-up send enabled after terminal error",
              });
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
                failedRows: Array.from(document.querySelectorAll('[data-message-role="user"]'))
                  .filter((message) => message.textContent?.includes(${JSON.stringify(failedPrompt)})).length,
                staleThinking: Array.from(document.querySelectorAll('[data-testid=assistant-current-state]'))
                  .some((element) => /正在思考|Thinking/i.test(element.textContent ?? "")),
                sendEnabled: window.__ipolloworkControl.listActions()
                  .some((action) => action.id === "composer.send" && !action.disabled),
              }))()`);
              ctx.assert(state.failedRows === 1, `The failed prompt rendered ${state.failedRows} times.`);
              ctx.assert(!state.staleThinking, "The failed turn still shows a thinking state.");
              ctx.assert(state.sendEnabled, "The follow-up send action remained disabled.");
            },
            screenshot: {
              name: "session-error-followup-ready",
              fromSurface: true,
              requireText: [failedPrompt, "本次任务未完成", recoveryPrompt],
            },
          });

          const assistantBaseline = await ctx.eval(
            `document.querySelectorAll('[data-message-role="assistant"]').length`,
          );
          await ctx.prove("The follow-up renders once and receives its own response below the failed turn", {
            voiceover: "发送下一条后，它只出现一次，并在原错误下方收到独立回复。",
            action: async () => {
              await ctx.control("composer.send");
              await ctx.waitFor(`(() => {
                const users = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                  .filter((message) => message.textContent?.includes(${JSON.stringify(recoveryPrompt)}));
                const assistants = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
                const stopDisabled = window.__ipolloworkControl.listActions()
                  .some((action) => action.id === "composer.stop" && action.disabled);
                return users.length === 1
                  && assistants.length > ${assistantBaseline}
                  && (assistants.at(-1)?.innerText ?? "").includes("恢复成功")
                  && stopDisabled;
              })()`, {
                timeoutMs: 120_000,
                label: "independent follow-up response",
              });
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const users = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                  .filter((message) => message.textContent?.includes(${JSON.stringify(recoveryPrompt)}));
                const assistants = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
                return {
                  matchingUsers: users.length,
                  latestAssistant: assistants.at(-1)?.innerText ?? "",
                  stopDisabled: window.__ipolloworkControl.listActions()
                    .some((action) => action.id === "composer.stop" && action.disabled),
                  staleThinking: Array.from(document.querySelectorAll('[data-testid=assistant-current-state]'))
                    .some((element) => /正在思考|Thinking/i.test(element.textContent ?? "")),
                };
              })()`);
              ctx.assert(state.matchingUsers === 1, `The follow-up rendered ${state.matchingUsers} times.`);
              ctx.assert(state.latestAssistant.includes("恢复成功"), `Unexpected follow-up response: ${state.latestAssistant}`);
              ctx.assert(state.stopDisabled, "The follow-up response did not reach an idle terminal state.");
              ctx.assert(!state.staleThinking, "The completed follow-up still shows a thinking state.");
            },
            screenshot: {
              name: "session-error-followup-completed",
              fromSurface: true,
              requireText: ["本次任务未完成", recoveryPrompt, "恢复成功"],
            },
          });
        } finally {
          // Keep the proof-only conversation for review. Never revert user history.
          const ownsCurrentSession = await ctx.eval(`location.hash.includes(${JSON.stringify(sessionId)})`);
          if (ownsCurrentSession) {
            const canStopAfter = await ctx.eval(`window.__ipolloworkControl.listActions()
              .some(action => action.id === "composer.stop" && !action.disabled)`);
            if (canStopAfter) await ctx.control("composer.stop");
          }
        }
      },
    },
  ],
};
