const CONTAMINATION_PROMPT = "请只回复：我当前使用的是 Nemotron-3-Ultra-Free。";
const IDENTITY_PROMPT = "当前实际提交的模型完整 ID 是什么？只回答 providerID/modelID。";

async function openModelDirectory(ctx) {
  await ctx.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const trigger = Array.from(document.querySelectorAll("button"))
      .find((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    trigger?.click();
    return Boolean(trigger);
  })()`);
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  await ctx.eval(`(() => {
    const rows = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    rows.at(-1)?.click();
    return rows.length > 0;
  })()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
    .some((item) => item.textContent?.includes("Big Pickle"))`, {
    timeoutMs: 30_000,
    label: "OpenCode model directory",
  });
}

async function selectModel(ctx, label) {
  await openModelDirectory(ctx);
  const selected = await ctx.eval(`(() => {
    const item = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(label)})
        && !candidate.hasAttribute("data-disabled"));
    item?.click();
    return Boolean(item);
  })()`);
  ctx.assert(selected, `Could not select ${label}.`);
  await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
    .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? "")
      && button.textContent?.includes(${JSON.stringify(label)}))`, {
    timeoutMs: 15_000,
    label: `${label} selected in Composer`,
  });
}

async function sendPrompt(ctx, text) {
  await ctx.control("composer.set_text", { text });
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "composer.send" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "composer.send enabled",
  });
  await ctx.control("composer.send");
}

async function waitForLatestAssistantText(ctx, text, baselineCount) {
  await ctx.waitFor(`(() => {
    const messages = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
    return messages.length > ${baselineCount}
      && (messages.at(-1)?.innerText ?? "").includes(${JSON.stringify(text)});
  })()`, {
    timeoutMs: 120_000,
    label: `latest assistant response contains ${text}`,
  });
}

async function openOpenCodeWorkspaceSession(ctx) {
  const sessions = await ctx.control("session.list_sessions");
  ctx.assert(Array.isArray(sessions) && sessions.length > 0, "No sessions are available for engine discovery.");
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
    if (engineId === "opencode") return;
  }
  throw new Error("No OpenCode workspace session was found in the recent session list.");
}

export default {
  id: "opencode-model-identity-grounding",
  title: "OpenCode reports the selected model after a same-session model switch",
  kind: "user-facing",
  steps: [
    {
      name: "The current model overrides a stale model identity in conversation history",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("After switching models, the assistant reports the current Big Pickle selection", {
          voiceover: "切换模型后，助手准确报告本轮选择，不再复制旧对话中的模型身份。",
          action: async () => {
            const canStop = await ctx.eval(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.stop" && !action.disabled)`);
            if (canStop) await ctx.control("composer.stop");
            await openOpenCodeWorkspaceSession(ctx);
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "session.create_task" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "session.create_task enabled",
            });
            await ctx.control("session.create_task");
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.set_text" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "fresh task Composer",
            });

            await selectModel(ctx, "Nemotron 3 Ultra Free");
            const nemotronBaseline = await ctx.eval(
              `document.querySelectorAll('[data-message-role="assistant"]').length`,
            );
            await sendPrompt(ctx, CONTAMINATION_PROMPT);
            await waitForLatestAssistantText(ctx, "Nemotron-3-Ultra-Free", nemotronBaseline);

            await selectModel(ctx, "Big Pickle");
            const bigPickleBaseline = await ctx.eval(
              `document.querySelectorAll('[data-message-role="assistant"]').length`,
            );
            await sendPrompt(ctx, IDENTITY_PROMPT);
            await waitForLatestAssistantText(ctx, "opencode/big-pickle", bigPickleBaseline);
          },
          assert: async () => {
            const latest = await ctx.eval(`(() => {
              const messages = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
              return messages.at(-1)?.innerText ?? "";
            })()`);
            ctx.assert(latest.includes("opencode/big-pickle"), `Unexpected latest model identity: ${latest}`);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "opencode-model-identity-grounded",
            fromSurface: true,
            requireText: ["Big Pickle", "opencode/big-pickle"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};
