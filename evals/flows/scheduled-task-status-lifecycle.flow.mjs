const ITEM_TITLE = "定时任务状态自动流转验证";

let fixture = null;

async function readContext(ctx) {
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
  return context;
}

async function cleanup(ctx, context) {
  if (!context) return;
  await ctx.eval(`(() => {
    if (window.__scheduledTaskStatusProof?.timer) clearInterval(window.__scheduledTaskStatusProof.timer);
    delete window.__scheduledTaskStatusProof;
    return true;
  })()`);
  await ctx.eval(`(async () => {
    const baseUrl = ${JSON.stringify(context.baseUrl)};
    const workspaceId = ${JSON.stringify(context.workspaceId)};
    const headers = {
      authorization: "Bearer " + ${JSON.stringify(context.token)},
      "content-type": "application/json",
    };
    const workResponse = await fetch(baseUrl + "/work-items?workspaceId=" + encodeURIComponent(workspaceId), { headers });
    if (workResponse.ok) {
      const work = await workResponse.json();
      for (const item of work.items.filter((candidate) => candidate.title === ${JSON.stringify(ITEM_TITLE)})) {
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
    if (sessionsResponse.ok) {
      const sessions = await sessionsResponse.json();
      for (const session of sessions.items.filter((candidate) => candidate.title === ${JSON.stringify(ITEM_TITLE)})) {
        await fetch(
          baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/sessions/" + encodeURIComponent(session.id),
          { method: "DELETE", headers },
        );
      }
    }
    return true;
  })()`, { awaitPromise: true });
}

async function taskStatus(ctx, expectedStatus) {
  return ctx.eval(`(async () => {
    const response = await fetch(
      ${JSON.stringify(fixture.baseUrl)} + "/work-items?workspaceId=" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}),
      { headers: { authorization: "Bearer " + ${JSON.stringify(fixture.token)} } },
    );
    const work = await response.json();
    const item = work.items.find((candidate) => candidate.id === ${JSON.stringify(fixture.itemId)});
    return item?.status === ${JSON.stringify(expectedStatus)};
  })()`, { awaitPromise: true });
}

export default {
  id: "scheduled-task-status-lifecycle",
  title: "Scheduled tasks automatically follow their execution lifecycle",
  kind: "user-facing",
  steps: [
    {
      name: "Follow one scheduled task through its lifecycle",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        await ctx.waitFor("!document.querySelector('[data-testid=startup-logo-animation]')", {
          timeoutMs: 30_000,
          label: "startup overlay dismissed",
        });
        await ctx.eval(`(() => {
          document.querySelector('[data-slot="sheet-close"]')?.click();
          [...document.querySelectorAll('[role="dialog"]')].forEach((dialog) => {
            const cancel = [...dialog.querySelectorAll("button")]
              .find((button) => button.textContent?.trim() === "取消");
            cancel?.click();
          });
          return true;
        })()`);
        fixture = await readContext(ctx);
        await cleanup(ctx, fixture);
        try {
          await ctx.prove("An enabled scheduled task starts in the Ready column", {
            voiceover: "When automatic execution is enabled, the task enters Ready immediately so I can see what will run next.",
            action: async () => {
              fixture.itemId = await ctx.eval(`(async () => {
                const response = await fetch(
                  ${JSON.stringify(fixture.baseUrl)} + "/workspace/" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}) + "/work-items",
                  {
                    method: "POST",
                    headers: {
                      authorization: "Bearer " + ${JSON.stringify(fixture.token)},
                      "content-type": "application/json",
                    },
                    body: JSON.stringify({
                      title: ${JSON.stringify(ITEM_TITLE)},
                      description: "请执行一个约十秒的等待，再只回复：定时任务已完成。",
                      status: "planned",
                      priority: "normal",
                      assignee: "project-lead",
                      startAt: Date.now() + 20_000,
                      dueAt: null,
                      automation: {
                        enabled: true,
                        recurrence: "once",
                        model: { providerId: "opencode", modelId: "big-pickle" },
                      },
                      customFields: {},
                    }),
                  },
                );
                if (!response.ok) throw new Error("Could not create lifecycle proof task: " + response.status);
                const item = await response.json();
                if (item.status !== "ready") throw new Error("Scheduled task did not enter Ready");
                return item.id;
              })()`, { awaitPromise: true });
              await ctx.eval(`(() => {
                document.querySelector('[data-testid="session-header-work-conversation"]')?.click();
                return true;
              })()`);
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=session-header-work-tasks]'))", {
                label: "project task navigation",
              });
              await ctx.eval(`(() => {
                document.querySelector('[data-testid="session-header-work-tasks"]')?.click();
                return true;
              })()`);
              await ctx.waitFor(`document.querySelector('[data-status="ready"]')?.textContent?.includes(${JSON.stringify(ITEM_TITLE)})`, {
                timeoutMs: 15_000,
                label: "scheduled task in Ready",
              });
            },
            assert: async () => {
              ctx.assert(await taskStatus(ctx, "ready"), "Expected the scheduled task to persist Ready status.");
            },
            screenshot: {
              name: "scheduled-task-ready",
              requireText: ["待执行", ITEM_TITLE],
            },
          });

          await ctx.prove("A due task passes through Running and exposes an engine failure", {
            voiceover: "At the scheduled time the task runs automatically, and if the model cannot answer, the same task moves into Failed with its conversation still linked.",
            action: async () => {
              await ctx.eval(`(() => {
                const proof = { statuses: [], finalStatus: "", error: "", sessionId: "", timer: 0 };
                const poll = async () => {
                  const response = await fetch(
                    ${JSON.stringify(fixture.baseUrl)} + "/work-items?workspaceId=" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}),
                    { headers: { authorization: "Bearer " + ${JSON.stringify(fixture.token)} } },
                  );
                  const work = await response.json();
                  const item = work.items.find((candidate) => candidate.id === ${JSON.stringify(fixture.itemId)});
                  if (item && proof.statuses.at(-1) !== item.status) proof.statuses.push(item.status);
                  if (item && ["review", "failed"].includes(item.status)) {
                    proof.finalStatus = item.status;
                    proof.error = item.automationLastError || "";
                    proof.sessionId = item.automationLastSessionId || "";
                    clearInterval(proof.timer);
                  }
                };
                proof.timer = setInterval(() => void poll(), 250);
                window.__scheduledTaskStatusProof = proof;
                void poll();
                return true;
              })()`);
              await ctx.waitFor('["review", "failed"].includes(window.__scheduledTaskStatusProof?.finalStatus)', {
                timeoutMs: 120_000,
                label: "scheduled task terminal status",
              });
              fixture.lifecycle = await ctx.eval(`(() => {
                const proof = window.__scheduledTaskStatusProof;
                return {
                  statuses: [...(proof?.statuses || [])],
                  finalStatus: proof?.finalStatus || "",
                  error: proof?.error || "",
                  sessionId: proof?.sessionId || "",
                };
              })()`);
              if (fixture.lifecycle.finalStatus !== "failed") {
                throw new Error(
                  `Expected the unavailable model to fail; received ${fixture.lifecycle.finalStatus || "<missing>"}.`,
                );
              }
              await ctx.eval(`(() => {
                document.querySelector('[data-testid="session-header-work-conversation"]')?.click();
                return true;
              })()`);
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=session-header-work-tasks]'))", {
                label: "project task navigation after completion",
              });
              await ctx.eval(`(() => {
                document.querySelector('[data-testid="session-header-work-tasks"]')?.click();
                return true;
              })()`);
              await ctx.waitFor(`document.querySelector('[data-status="failed"]')?.textContent?.includes(${JSON.stringify(ITEM_TITLE)})`, {
                timeoutMs: 15_000,
                label: "scheduled task in Failed",
              });
            },
            assert: async () => {
              ctx.assert(
                fixture.lifecycle.statuses.includes("running"),
                `Expected the scheduler to record Running; observed ${fixture.lifecycle.statuses.join(" → ") || "<none>"}.`,
              );
              ctx.assert(
                fixture.lifecycle.finalStatus === "failed",
                `Expected Failed after the engine error; received ${fixture.lifecycle.finalStatus || "<missing>"}.`,
              );
              ctx.assert(Boolean(fixture.lifecycle.error), "Expected the engine failure detail to be persisted.");
              ctx.assert(Boolean(fixture.lifecycle.sessionId), "Expected the automatic run to remain linked to its conversation.");
              ctx.assert(await taskStatus(ctx, "failed"), "Expected the failed scheduled task to persist Failed status.");
            },
            screenshot: {
              name: "scheduled-task-failed",
              requireText: ["失败", ITEM_TITLE],
            },
          });
        } finally {
          await cleanup(ctx, fixture);
          fixture = null;
        }
      },
    },
  ],
};
