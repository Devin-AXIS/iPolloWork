async function openReadySession(ctx) {
  const sessions = await ctx.control("session.list_sessions");
  ctx.assert(Array.isArray(sessions), "The session list was unavailable.");
  for (const session of [...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 12)) {
    try {
      await ctx.control("session.open", { sessionId: session.sessionId });
      await ctx.waitFor(`(() => {
        if (!window.__ipolloworkControl.snapshot().route.includes(${JSON.stringify(session.sessionId)})) return false;
        return window.__ipolloworkControl.listActions()
          .some((action) => action.id === "eval.session.seed_error" && !action.disabled);
      })()`, {
        timeoutMs: 10_000,
        label: `error-boundary controls for ${session.sessionId}`,
      });
      return session.sessionId;
    } catch {
      // A recent session can belong to a disconnected workspace; try another.
    }
  }
  throw new Error("No ready session was available for the error recovery proof.");
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
        await openReadySession(ctx);
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
              await ctx.waitForText(errorText, { timeoutMs: 10_000 });
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
                  .filter((message) => message.textContent?.trim() === ${JSON.stringify(failedPrompt)}).length,
                staleThinking: Array.from(document.querySelectorAll('[role="status"]'))
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
              requireText: [failedPrompt, errorText, recoveryPrompt],
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
                  .filter((message) => message.textContent?.trim() === ${JSON.stringify(recoveryPrompt)});
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
                  .filter((message) => message.textContent?.trim() === ${JSON.stringify(recoveryPrompt)});
                const assistants = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
                return {
                  matchingUsers: users.length,
                  latestAssistant: assistants.at(-1)?.innerText ?? "",
                  stopDisabled: window.__ipolloworkControl.listActions()
                    .some((action) => action.id === "composer.stop" && action.disabled),
                  staleThinking: Array.from(document.querySelectorAll('[role="status"]'))
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
              requireText: [errorText, recoveryPrompt, "恢复成功"],
            },
          });
        } finally {
          // Remove only this flow's authoritative follow-up and reload. The
          // deterministic failed turn is client-only, so it disappears with
          // the reload and repeated proof runs do not pollute user history.
          const canStopAfter = await ctx.eval(`window.__ipolloworkControl.listActions()
            .some((action) => action.id === "composer.stop" && !action.disabled)`).catch(() => false);
          if (canStopAfter) await ctx.control("composer.stop").catch(() => undefined);
          await ctx.eval(`(() => {
            const row = Array.from(document.querySelectorAll('[data-message-role="user"]'))
              .find((message) => message.textContent?.trim() === ${JSON.stringify(recoveryPrompt)});
            const revert = row ? Array.from(row.querySelectorAll("button")).at(-1) : null;
            revert?.click();
            return Boolean(revert);
          })()`).catch(() => false);
          await ctx.eval("new Promise((resolve) => setTimeout(() => resolve(true), 1200))", { awaitPromise: true });
          await ctx.eval("location.reload(); true").catch(() => undefined);
        }
      },
    },
  ],
};
