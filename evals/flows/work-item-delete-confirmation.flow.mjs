const ITEM_TITLE = "删除后弹窗关闭验证";

let fixture = null;

async function prepareFixture(ctx) {
  fixture = await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port") || "";
    const baseUrl = localStorage.getItem("ipollowork.server.urlOverride")
      || localStorage.getItem("ipollowork.server.active")
      || (port ? "http://127.0.0.1:" + port : "");
    const token = localStorage.getItem("ipollowork.server.token") || "";
    const workspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1]
      || localStorage.getItem("ipollowork.react.activeWorkspace")
      || "";
    if (!baseUrl || !token || !workspaceId) throw new Error("Active project server context is unavailable");
    const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
    const listUrl = baseUrl + "/work-items?workspaceId=" + encodeURIComponent(workspaceId);
    const existingResponse = await fetch(listUrl, { headers });
    if (!existingResponse.ok) throw new Error("Could not read project tasks: " + existingResponse.status);
    const existing = await existingResponse.json();
    for (const item of existing.items.filter((candidate) => candidate.title === ${JSON.stringify(ITEM_TITLE)})) {
      const response = await fetch(
        baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/work-items/" + encodeURIComponent(item.id) + "?version=" + item.version,
        { method: "DELETE", headers },
      );
      if (!response.ok) throw new Error("Could not remove a stale proof task: " + response.status);
    }
    const createResponse = await fetch(baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/work-items", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: ${JSON.stringify(ITEM_TITLE)},
        description: "验证删除成功后确认弹窗会关闭",
        status: "planned",
        priority: "normal",
        assignee: "project-lead",
        startAt: null,
        dueAt: null,
        customFields: {},
      }),
    });
    if (!createResponse.ok) throw new Error("Could not create the proof task: " + createResponse.status);
    const item = await createResponse.json();
    return { baseUrl, token, workspaceId, itemId: item.id };
  })()`, { awaitPromise: true });
  ctx.assert(Boolean(fixture?.itemId), "Expected a temporary task for the delete proof.");
}

async function cleanupFixture(ctx) {
  if (!fixture) return;
  await ctx.eval(`(async () => {
    const headers = { authorization: "Bearer " + ${JSON.stringify(fixture.token)} };
    const listResponse = await fetch(
      ${JSON.stringify(fixture.baseUrl)} + "/work-items?workspaceId=" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}),
      { headers },
    );
    if (!listResponse.ok) return false;
    const payload = await listResponse.json();
    const item = payload.items.find((candidate) => candidate.id === ${JSON.stringify(fixture.itemId)});
    if (!item) return true;
    const response = await fetch(
      ${JSON.stringify(fixture.baseUrl)} + "/workspace/" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}) + "/work-items/" + encodeURIComponent(item.id) + "?version=" + item.version,
      { method: "DELETE", headers },
    );
    return response.ok;
  })()`, { awaitPromise: true });
  fixture = null;
}

export default {
  id: "work-item-delete-confirmation",
  title: "Successful task deletion dismisses its confirmation",
  kind: "user-facing",
  steps: [
    {
      name: "Delete a project task",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        await ctx.waitFor("!document.querySelector('[data-testid=startup-logo-animation]')", {
          timeoutMs: 30_000,
          label: "startup overlay dismissed",
        });
        await ctx.eval(`(() => {
          document.querySelector('[data-slot="sheet-close"]')?.click();
          [...document.querySelectorAll('[role="alertdialog"]')].forEach((dialog) => {
            const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "取消");
            cancel?.click();
          });
          return true;
        })()`);
        await prepareFixture(ctx);
        try {
          await ctx.prove("A successfully deleted task disappears together with its confirmation dialog", {
            voiceover: "After confirming deletion, the task disappears and the confirmation closes immediately, returning me to the project board.",
            action: async () => {
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=session-header-work-tasks]'))", {
                label: "project task navigation",
              });
              await ctx.eval("document.querySelector('[data-testid=session-header-work-tasks]').click(); true");
              await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(ITEM_TITLE)})`, {
                timeoutMs: 30_000,
                label: "temporary task on project board",
              });
              await ctx.eval(`(() => {
                const heading = [...document.querySelectorAll("article h3")]
                  .find((node) => node.textContent?.trim() === ${JSON.stringify(ITEM_TITLE)});
                const button = heading?.closest("button");
                if (!button) throw new Error("Temporary task card was not found");
                button.click();
                return true;
              })()`);
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=work-item-sheet]'))", {
                label: "task editor opened",
              });
              await ctx.eval(`(() => {
                const sheet = document.querySelector('[data-testid="work-item-sheet"]');
                const button = sheet && [...sheet.querySelectorAll("button")]
                  .find((candidate) => candidate.textContent?.trim() === "删除");
                if (!button) throw new Error("Task delete button was not found");
                button.click();
                return true;
              })()`);
              await ctx.waitFor("document.body.innerText.includes('删除这个任务？')", {
                label: "delete confirmation opened",
              });
              await ctx.eval(`(() => {
                const dialog = [...document.querySelectorAll('[role="alertdialog"]')]
                  .find((candidate) => candidate.textContent?.includes("删除这个任务？"));
                const button = dialog && [...dialog.querySelectorAll("button")]
                  .find((candidate) => candidate.textContent?.trim() === "删除");
                if (!button) throw new Error("Delete confirmation button was not found");
                button.click();
                return true;
              })()`);
              await ctx.waitFor(`!document.body.innerText.includes(${JSON.stringify(ITEM_TITLE)})
                && !document.body.innerText.includes("删除这个任务？")
                && !document.querySelector('[data-testid="work-item-sheet"]')`, {
                timeoutMs: 30_000,
                label: "task and deletion surfaces dismissed",
              });
            },
            assert: async () => {
              const deleted = await ctx.eval(`fetch(
                ${JSON.stringify(fixture.baseUrl)} + "/work-items?workspaceId=" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}),
                { headers: { authorization: "Bearer " + ${JSON.stringify(fixture.token)} } },
              ).then((response) => response.json())
                .then((payload) => !payload.items.some((item) => item.id === ${JSON.stringify(fixture.itemId)}))`, { awaitPromise: true });
              ctx.assert(deleted === true, "Expected the task to be deleted from the server.");
              await ctx.expectNoText("删除这个任务？");
              await ctx.expectNoText(ITEM_TITLE);
            },
            screenshot: {
              name: "task-deleted-dialog-dismissed",
              requireText: ["项目任务", "看板"],
              rejectText: ["删除这个任务？", ITEM_TITLE],
            },
          });
        } finally {
          await cleanupFixture(ctx);
        }
      },
    },
  ],
};
