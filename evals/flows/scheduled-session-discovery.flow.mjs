const ITEM_TITLE = "定时任务会话自动出现验证";
const MODEL_ITEM_TITLE = "定时任务执行模型验证";

let fixture = null;

async function removeProofArtifacts(ctx, context) {
  await ctx.eval(`(async () => {
    const baseUrl = ${JSON.stringify(context.baseUrl)};
    const token = ${JSON.stringify(context.token)};
    const workspaceId = ${JSON.stringify(context.workspaceId)};
    const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
    const workResponse = await fetch(baseUrl + "/work-items?workspaceId=" + encodeURIComponent(workspaceId), { headers });
    if (workResponse.ok) {
      const work = await workResponse.json();
      for (const item of work.items.filter((candidate) => [
        ${JSON.stringify(ITEM_TITLE)},
        ${JSON.stringify(MODEL_ITEM_TITLE)},
      ].includes(candidate.title))) {
        await fetch(
          baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/work-items/" + encodeURIComponent(item.id) + "?version=" + item.version,
          { method: "DELETE", headers },
        );
      }
    }
    const sessionsResponse = await fetch(
      baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/sessions?limit=200",
      { headers },
    );
    if (!sessionsResponse.ok) return true;
    const sessions = await sessionsResponse.json();
    for (const session of sessions.items.filter((candidate) => candidate.title === ${JSON.stringify(ITEM_TITLE)})) {
      const deleted = await fetch(
        baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/sessions/" + encodeURIComponent(session.id),
        { method: "DELETE", headers },
      );
      if (deleted.status === 501) {
        await fetch(
          baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/engine/deepseek-harness/rpc",
          {
            method: "POST",
            headers,
            body: JSON.stringify({ method: "workspace.archiveSession", payload: { sessionId: session.id } }),
          },
        );
      }
    }
    return true;
  })()`, { awaitPromise: true });
}

async function prepareFixture(ctx) {
  const context = await ctx.eval(`(() => {
    const port = localStorage.getItem("ipollowork.server.port") || "";
    const baseUrl = localStorage.getItem("ipollowork.server.urlOverride")
      || localStorage.getItem("ipollowork.server.active")
      || (port ? "http://127.0.0.1:" + port : "");
    const token = localStorage.getItem("ipollowork.server.token") || "";
    const workspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1]
      || localStorage.getItem("ipollowork.react.activeWorkspace")
      || "";
    return { baseUrl, token, workspaceId };
  })()`);
  ctx.assert(Boolean(context?.baseUrl && context?.token && context?.workspaceId), "Expected an active project server context.");
  await removeProofArtifacts(ctx, context);
  fixture = await ctx.eval(`(async () => {
    const baseUrl = ${JSON.stringify(context.baseUrl)};
    const token = ${JSON.stringify(context.token)};
    const workspaceId = ${JSON.stringify(context.workspaceId)};
    const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
    const response = await fetch(baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/work-items", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: ${JSON.stringify(ITEM_TITLE)},
        description: "验证后台定时任务创建的会话会自动同步到当前项目",
        status: "planned",
        priority: "normal",
        startAt: Date.now() - 1_000,
        dueAt: null,
        automation: {
          enabled: true,
          recurrence: "once",
          model: { providerId: "openai", modelId: "gpt-5.5" },
        },
        customFields: {},
      }),
    });
    if (!response.ok) throw new Error("Could not create the scheduled proof task: " + response.status);
    const item = await response.json();
    const modelResponse = await fetch(baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/work-items", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: ${JSON.stringify(MODEL_ITEM_TITLE)},
        description: "验证自动执行可以保存指定模型",
        status: "planned",
        priority: "normal",
        startAt: Date.now() + 60 * 60 * 1000,
        dueAt: null,
        automation: {
          enabled: true,
          recurrence: "once",
          model: { providerId: "openai", modelId: "gpt-5.5" },
        },
        customFields: {},
      }),
    });
    if (!modelResponse.ok) throw new Error("Could not create the model proof task: " + modelResponse.status);
    const modelItem = await modelResponse.json();
    return { baseUrl, token, workspaceId, itemId: item.id, modelItemId: modelItem.id };
  })()`, { awaitPromise: true });
}

export default {
  id: "scheduled-session-discovery",
  title: "Scheduled sessions appear in the current project",
  kind: "user-facing",
  steps: [
    {
      name: "Discover the scheduled task session",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        await ctx.waitFor("!document.querySelector('[data-testid=startup-logo-animation]')", {
          timeoutMs: 30_000,
          label: "startup overlay dismissed",
        });
        await ctx.eval(`(() => {
          document.querySelector('[data-slot="sheet-close"]')?.click();
          [...document.querySelectorAll('[role="dialog"]')].forEach((dialog) => {
            const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "取消");
            cancel?.click();
          });
          document.querySelector('[data-testid="session-header-work-conversation"]')?.click();
          return true;
        })()`);
        await prepareFixture(ctx);
        try {
          await ctx.prove("A scheduled task creates a session that automatically appears under the current project", {
            voiceover: "After the scheduled task starts in the background, its conversation appears automatically under the current project without restarting the app.",
            action: async () => {
              await ctx.waitFor(`Boolean([...document.querySelectorAll("span[title]")]
                .find((node) => node.getAttribute("title") === ${JSON.stringify(ITEM_TITLE)}))`, {
                timeoutMs: 45_000,
                label: "scheduled session in the current project sidebar",
              });
            },
            assert: async () => {
              const state = await ctx.eval(`(async () => {
                const headers = { authorization: "Bearer " + ${JSON.stringify(fixture.token)} };
                const work = await fetch(
                  ${JSON.stringify(fixture.baseUrl)} + "/work-items?workspaceId=" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}),
                  { headers },
                ).then((response) => response.json());
                const task = work.items.find((candidate) => candidate.id === ${JSON.stringify(fixture.itemId)});
                if (!task?.automationLastSessionId) return { taskStarted: false, serverSession: false, cachedSession: false };
                const sessions = await fetch(
                  ${JSON.stringify(fixture.baseUrl)} + "/workspace/" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}) + "/sessions?limit=200",
                  { headers },
                ).then((response) => response.json());
                const route = window.__ipollowork?.slice?.("route");
                return {
                  taskStarted: task.automationLastRunAt !== null && task.automationLastError === null,
                  serverSession: sessions.items.some((session) => session.id === task.automationLastSessionId && session.title === ${JSON.stringify(ITEM_TITLE)}),
                  cachedSession: (route?.sessionsByWorkspaceId?.[${JSON.stringify(fixture.workspaceId)}] || [])
                    .some((session) => session.id === task.automationLastSessionId && session.title === ${JSON.stringify(ITEM_TITLE)}),
                };
              })()`, { awaitPromise: true });
              ctx.assert(state.taskStarted, "Expected the scheduled task to start without an error.");
              ctx.assert(state.serverSession, "Expected the engine session to exist on the project server.");
              ctx.assert(state.cachedSession, "Expected the new session to be merged into the visible project cache.");
              await ctx.expectText(ITEM_TITLE);
            },
            screenshot: {
              name: "scheduled-session-visible-in-project",
              requireText: [ITEM_TITLE],
            },
          });
          await ctx.prove("A scheduled task can choose the model used for automatic execution", {
            voiceover: "The automatic execution settings now preserve an explicit model choice instead of always relying on the project default.",
            action: async () => {
              await ctx.eval('document.querySelector("[data-testid=session-header-work-tasks]").click(); true');
              await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(MODEL_ITEM_TITLE)})`, {
                label: "model proof task in the project board",
              });
              await ctx.eval(`(() => {
                const card = [...document.querySelectorAll("article")]
                  .find((candidate) => candidate.textContent?.includes(${JSON.stringify(MODEL_ITEM_TITLE)}));
                const button = card?.querySelector("button");
                if (!button) throw new Error("Model proof task card not found");
                button.click();
                return true;
              })()`);
              await ctx.waitFor('Boolean(document.querySelector("#work-item-automation-model"))', {
                label: "automatic execution model selector",
              });
              await ctx.eval(`(() => {
                const automation = document.querySelector('[data-testid="work-item-automation"]');
                automation?.scrollIntoView({ block: "center" });
                return true;
              })()`);
            },
            assert: async () => {
              const selectedModel = await ctx.eval('document.querySelector("#work-item-automation-model")?.value || ""');
              ctx.assert(
                selectedModel === JSON.stringify(["openai", "gpt-5.5"]),
                `Expected the saved automatic execution model to remain selected; received ${selectedModel || "<empty>"}.`,
              );
              await ctx.expectText("执行模型");
              await ctx.expectText("GPT-5.5");
            },
            screenshot: {
              name: "scheduled-task-model-selector",
              requireText: [MODEL_ITEM_TITLE, "自动执行", "执行模型", "GPT-5.5"],
            },
          });
          await ctx.prove("An expired model sign-in becomes a visible conversation reply", {
            voiceover: "When the model login has expired, the scheduled conversation now explains that failure instead of remaining blank.",
            action: async () => {
              await ctx.eval(`(() => {
                document.querySelector('[data-slot="sheet-close"]')?.click();
                document.querySelector('[data-testid="session-header-work-conversation"]')?.click();
                return true;
              })()`);
              await ctx.waitFor(`Boolean([...document.querySelectorAll("span[title]")]
                .find((node) => node.getAttribute("title") === ${JSON.stringify(ITEM_TITLE)}))`, {
                timeoutMs: 30_000,
                label: "scheduled proof conversation",
              });
              await ctx.eval(`(() => {
                const title = [...document.querySelectorAll("span[title]")]
                  .find((node) => node.getAttribute("title") === ${JSON.stringify(ITEM_TITLE)});
                const target = title?.closest("button") || title?.closest('[role="button"]') || title?.parentElement;
                if (!(target instanceof HTMLElement)) throw new Error("Scheduled proof conversation trigger not found");
                target.click();
                return true;
              })()`);
              await ctx.waitFor('document.body.innerText.includes("模型登录凭证已过期，请重新登录后重试本条消息。")', {
                timeoutMs: 45_000,
                label: "expired model sign-in reply",
              });
            },
            assert: async () => {
              await ctx.expectText("模型登录凭证已过期，请重新登录后重试本条消息。");
            },
            screenshot: {
              name: "scheduled-session-auth-error-reply",
              requireText: [ITEM_TITLE, "模型登录凭证已过期，请重新登录后重试本条消息。"],
            },
          });
        } finally {
          await removeProofArtifacts(ctx, fixture);
          fixture = null;
        }
      },
    },
  ],
};
