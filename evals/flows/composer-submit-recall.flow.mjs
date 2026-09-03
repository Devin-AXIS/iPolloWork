async function openOpenCodeSession(ctx) {
  const sessions = await ctx.control("session.list_sessions");
  ctx.assert(Array.isArray(sessions) && sessions.length > 0, "No sessions are available.");
  for (const session of sessions.slice(0, 12)) {
    await ctx.control("session.open", { sessionId: session.sessionId });
    const engineId = await ctx.waitFor(`(() => {
      if (!window.__ipolloworkControl.snapshot().route.includes(${JSON.stringify(session.sessionId)})) return null;
      return document.querySelector('[data-testid="session-composer-engine-badge"]')
        ?.getAttribute("data-engine-id") || null;
    })()`, {
      timeoutMs: 15_000,
      label: `session ${session.sessionId} engine badge`,
    });
    if (engineId === "opencode") return session.sessionId;
  }
  throw new Error("No OpenCode session was found in the recent session list.");
}

export default {
  id: "composer-submit-recall",
  title: "Composer clears accepted prompts and recalls the latest session request",
  kind: "user-facing",
  steps: [
    {
      name: "Sending clears the composer and ArrowUp recalls the sent request",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        const sessionId = await openOpenCodeSession(ctx);
        const canStop = await ctx.eval(`window.__ipolloworkControl.listActions()
          .some((action) => action.id === "composer.stop" && !action.disabled)`);
        if (canStop) await ctx.control("composer.stop");

        const prompt = `只回复：COMPOSER-RECALL-${Date.now()}`;
        await ctx.prove("An accepted prompt clears immediately and ArrowUp restores exactly that request", {
          voiceover: "消息发出后输入框会立即清空，按上方向键可以从当前任务记录中恢复上一条需求。",
          action: async () => {
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.set_text" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "composer.set_text enabled",
            });
            await ctx.control("composer.set_text", { text: prompt });
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.send" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "composer.send enabled",
            });
            await ctx.control("composer.send");
            await ctx.waitFor(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              const userMessages = Array.from(document.querySelectorAll('[data-message-role="user"]'));
              return (editor?.textContent ?? "").trim() === ""
                && userMessages.some((message) => message.textContent?.includes(${JSON.stringify(prompt)}));
            })()`, {
              timeoutMs: 30_000,
              label: "sent prompt visible and Composer empty",
            });
            const recalled = await ctx.eval(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              if (!(editor instanceof HTMLElement)) return false;
              editor.focus();
              return editor.dispatchEvent(new KeyboardEvent("keydown", {
                key: "ArrowUp",
                code: "ArrowUp",
                bubbles: true,
                cancelable: true,
              }));
            })()`);
            ctx.assert(recalled === false, "ArrowUp was not handled by the Composer history control.");
            await ctx.waitFor(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              return (editor?.textContent ?? "").trim() === ${JSON.stringify(prompt)};
            })()`, {
              timeoutMs: 15_000,
              label: "latest prompt recalled into Composer",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              const matchingUserMessages = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                .filter((message) => message.textContent?.includes(${JSON.stringify(prompt)}));
              return {
                composer: (editor?.textContent ?? "").trim(),
                matchingUserMessages: matchingUserMessages.length,
              };
            })()`);
            ctx.assert(state.composer === prompt, `Unexpected recalled Composer text: ${state.composer}`);
            ctx.assert(state.matchingUserMessages === 1,
              `Expected one sent user message, found ${state.matchingUserMessages}.`);
          },
          screenshot: {
            name: "composer-submit-clears-and-arrow-up-recalls",
            fromSurface: true,
            requireText: [prompt],
          },
        });

        const canStopAfter = await ctx.eval(`window.__ipolloworkControl.listActions()
          .some((action) => action.id === "composer.stop" && !action.disabled)`);
        if (canStopAfter) await ctx.control("composer.stop");

        const interruptedPrompt = `STOP-RACE-${Date.now()} 请先检查当前项目再回答。`;
        const enterPrompt = interruptedPrompt;
        await ctx.prove("Stopping an accepted run lets the same request be submitted again with plain Enter", {
          voiceover: "运行可以被立即停止，随后即使输入相同内容，按回车也会显示并发送一条新的需求。",
          action: async () => {
            await ctx.control("composer.set_text", { text: interruptedPrompt });
            await ctx.control("composer.send");
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.stop" && !action.disabled)`, {
              timeoutMs: 15_000,
              label: "stop enabled for the accepted run",
            });
            await ctx.control("composer.stop");
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.stop" && action.disabled)`, {
              timeoutMs: 30_000,
              label: "run stopped and Composer released",
            });
            await ctx.control("composer.set_text", { text: enterPrompt });
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
              return (editor?.textContent ?? "").trim() === ""
                && Array.from(document.querySelectorAll('[data-message-role="user"]'))
                  .some((message) => message.textContent?.includes(${JSON.stringify(enterPrompt)}));
            })()`, {
              timeoutMs: 30_000,
              label: "plain Enter sent the next request",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              const matching = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                .filter((message) => message.textContent?.includes(${JSON.stringify(enterPrompt)}));
              return { composer: (editor?.textContent ?? "").trim(), matching: matching.length };
            })()`);
            ctx.assert(state.composer === "", "Plain Enter left text in the Composer instead of submitting it.");
            ctx.assert(state.matching === 2, `Expected the repeated request to appear twice, found ${state.matching}.`);
          },
          screenshot: {
            name: "composer-stop-restores-enter-submit",
            fromSurface: true,
            requireText: [enterPrompt],
          },
        });

        const canStopEnterRun = await ctx.eval(`window.__ipolloworkControl.listActions()
          .some((action) => action.id === "composer.stop" && !action.disabled)`);
        if (canStopEnterRun) await ctx.control("composer.stop");
        ctx.assert(sessionId.length > 0, "The proof did not run in a session.");
      },
    },
  ],
};
