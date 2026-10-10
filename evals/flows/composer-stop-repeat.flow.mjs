async function openReadySession(ctx) {
  const sessions = await ctx.control("session.list_sessions");
  ctx.assert(Array.isArray(sessions), "The session list was unavailable.");
  const candidates = [...sessions].sort((left, right) => {
    const leftPreferred = left.title === "当前是什么模型" ? 1 : 0;
    const rightPreferred = right.title === "当前是什么模型" ? 1 : 0;
    return rightPreferred - leftPreferred || right.updatedAt - left.updatedAt;
  });
  for (const session of candidates.slice(0, 12)) {
    try {
      await ctx.control("session.open", { sessionId: session.sessionId });
      await ctx.waitFor(`(() => {
        if (!window.__ipolloworkControl.snapshot().route.includes(${JSON.stringify(session.sessionId)})) return false;
        return window.__ipolloworkControl.listActions()
          .some((action) => action.id === "composer.set_text" && !action.disabled);
      })()`, {
        timeoutMs: 8_000,
        label: `ready Composer for ${session.sessionId}`,
      });
      return session.sessionId;
    } catch {
      // Try the next recent session when one is unavailable to this client.
    }
  }
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "create task action for a fresh profile",
  });
  await ctx.control("session.create_task");
  const sessionId = await ctx.waitFor(`(() => {
    const match = window.__ipolloworkControl.snapshot().route.match(/ses_[A-Za-z0-9]+/);
    return match?.[0] ?? null;
  })()`, {
    timeoutMs: 30_000,
    label: "new session route",
  });
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "composer.set_text" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "ready Composer for the new session",
  });
  return sessionId;
}

export default {
  id: "composer-stop-repeat",
  title: "Stopping a run allows the same request to be sent again",
  kind: "user-facing",
  steps: [
    {
      name: "Stop, then repeat the same request",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        const sessionId = await openReadySession(ctx);
        const canStop = await ctx.eval(`window.__ipolloworkControl.listActions()
          .some((action) => action.id === "composer.stop" && !action.disabled)`);
        if (canStop) await ctx.control("composer.stop");

        const prompt = "123";
        const baseline = await ctx.eval(`(() => ({
          matchingUsers: Array.from(document.querySelectorAll('[data-message-role="user"]'))
            .filter((message) => message.textContent?.trim() === "123").length,
          assistants: document.querySelectorAll('[data-message-role="assistant"]').length,
          htmlArtifacts: new Set(document.body.innerText.match(/123-[a-z0-9]+\\.html/gi) ?? []).size,
        }))()`);
        await ctx.prove("The repeated request completes once and the stopped request never resurrects", {
          voiceover: "第一次请求暂停后，第二次相同请求可以正常回复，而被暂停请求的迟到内容不会复活。",
          action: async () => {
            await ctx.control("composer.set_text", { text: prompt });
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.send" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "send action after cold model readiness",
            });
            await ctx.eval(`(() => {
              void window.__ipolloworkControl.execute("composer.send", null);
              return true;
            })()`);
            await ctx.waitFor(`(() => {
              const stopButton = Array.from(document.querySelectorAll("button")).find((button) =>
                ["停止", "Stop"].includes(button.getAttribute("aria-label")) && !button.disabled
              );
              const matching = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                .filter((message) => message.textContent?.trim() === "123");
              return Boolean(stopButton) && matching.length === ${baseline.matchingUsers + 1};
            })()`, {
              timeoutMs: 15_000,
              label: "real stop button after the first optimistic message",
            });
            await ctx.eval(`(() => {
              const stopButton = Array.from(document.querySelectorAll("button")).find((button) =>
                ["停止", "Stop"].includes(button.getAttribute("aria-label")) && !button.disabled
              );
              if (!stopButton) throw new Error("The real stop button disappeared before the click.");
              stopButton.click();
              return true;
            })()`);
            await ctx.waitFor(`(() => {
              const stopDisabled = window.__ipolloworkControl.listActions()
                .some((action) => action.id === "composer.stop" && action.disabled);
              const staleThinking = Array.from(document.querySelectorAll('[role="status"]'))
                .some((element) => element.textContent?.includes("正在思考"));
              return window.__ipolloworkControl.snapshot().busyActionId === null
                && stopDisabled
                && !staleThinking;
            })()`, {
              timeoutMs: 30_000,
              label: "stopped run remains ready without stale thinking",
            });
            await ctx.eval("new Promise((resolve) => setTimeout(() => resolve(true), 4000))");
            const artifactsAfterStop = await ctx.eval(`new Set(
              document.body.innerText.match(/123-[a-z0-9]+\\.html/gi) ?? []
            ).size`);
            ctx.assert(
              artifactsAfterStop === baseline.htmlArtifacts,
              `Immediate stop produced a late HTML artifact: ${baseline.htmlArtifacts} -> ${artifactsAfterStop}`,
            );

            await ctx.control("composer.set_text", { text: prompt });
            await ctx.eval(`document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')?.focus()`);
            await ctx.client.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
            });
            await ctx.client.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
            });
            await ctx.waitFor(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              const matching = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                .filter((message) => message.textContent?.trim() === "123");
              return (editor?.textContent ?? "").trim() === ""
                && matching.length === ${baseline.matchingUsers + 2};
            })()`, {
              timeoutMs: 30_000,
              label: "identical request rendered as a second user message",
            });
            await ctx.waitFor(`(() => {
              const assistants = document.querySelectorAll('[data-message-role="assistant"]').length;
              const stopDisabled = window.__ipolloworkControl.listActions()
                .some((action) => action.id === "composer.stop" && action.disabled);
              return assistants >= ${baseline.assistants + 1}
                && stopDisabled;
            })()`, {
              timeoutMs: 90_000,
              label: "second identical request completed with one response",
            });
            await ctx.eval("new Promise((resolve) => setTimeout(() => resolve(true), 8000))");
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              const matching = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                .filter((message) => message.textContent?.trim() === "123");
              return {
                composer: (editor?.textContent ?? "").trim(),
                matching: matching.length,
                assistants: document.querySelectorAll('[data-message-role="assistant"]').length,
              };
            })()`);
            ctx.assert(state.composer === "", "The repeated request remained in the Composer.");
            ctx.assert(
              state.matching === baseline.matchingUsers + 2,
              `Expected two new identical user messages, found ${state.matching - baseline.matchingUsers}.`,
            );
            ctx.assert(
              state.assistants === baseline.assistants + 1,
              `Expected only the second request to reply, but found ${state.assistants - baseline.assistants} new assistant messages.`,
            );
          },
          screenshot: {
            name: "composer-stop-repeat-same-request",
            fromSurface: true,
            requireText: [prompt],
          },
        });

        const canStopAfter = await ctx.eval(`window.__ipolloworkControl.listActions()
          .some((action) => action.id === "composer.stop" && !action.disabled)`);
        if (canStopAfter) await ctx.control("composer.stop");
        ctx.assert(sessionId.length > 0, "The proof did not run in a session.");
      },
    },
  ],
};
