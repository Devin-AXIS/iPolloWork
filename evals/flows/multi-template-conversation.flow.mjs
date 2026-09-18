const VOICEOVER = "在同一个对话里再次使用演示模板后，系统直接打开新的独立模板需求，不再要求新建任务，原网站模板和新演示文稿也分别保存在自己的产物目录中。";

async function createTemplateConversation(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
    timeoutMs: 60_000,
    label: "iPolloWork control API",
  });
  await ctx.control("route.session");
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 45_000,
    label: "available local project",
  });
  await ctx.control("session.create_task");
  await ctx.waitFor(`location.hash.includes("/session/")`, {
    timeoutMs: 45_000,
    label: "new task route",
  });

  const setup = await ctx.eval(`(async () => {
    const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop("ipolloworkServerInfo");
    const token = (info.ownerToken || info.clientToken || "").trim();
    const workspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || "";
    const conversationId = location.hash.match(/\\/session\\/([^/?#]+)/)?.[1] || "";
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const templateIds = [
      "ipollowork.html-anything.saas-landing",
      "ipollowork.html-anything.deck-pitch",
    ];
    for (const templateId of templateIds) {
      const install = await fetch(info.baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/templates/" + encodeURIComponent(templateId) + "/install", {
        method: "POST",
        headers,
      });
      if (!install.ok && install.status !== 409) return { ok: false, stage: "install", status: install.status, templateId };
    }
    const firstTemplateSessionId = conversationId + "-artifact-site";
    const materialized = await fetch(info.baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/templates/" + encodeURIComponent(templateIds[0]) + "/materialize", {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: firstTemplateSessionId }),
    });
    sessionStorage.setItem("fraimz-multi-template-session-id", conversationId);
    return { ok: materialized.ok, stage: "materialize", status: materialized.status, conversationId };
  })()`, { awaitPromise: true });
  ctx.assert(setup.ok, `Could not prepare the first template instance: ${JSON.stringify(setup)}`);

  await ctx.client.send("Page.reload", { ignoreCache: true });
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "reloaded template conversation" });
  await ctx.waitFor(`document.body.innerText.includes("SaaS Landing")`, {
    timeoutMs: 45_000,
    label: "first template brief",
  });
  await ctx.clickText("取消", { selector: '[role="dialog"] button', timeoutMs: 15_000 });
  await ctx.waitFor(`!document.querySelector('[data-testid="template-apply-dialog"]')`, {
    timeoutMs: 15_000,
    label: "first brief dismissed",
  });
}

async function openCurrentConversationTemplates(ctx) {
  const plusClicked = await ctx.eval(`(() => {
    const button = document.querySelector('button[title="添加到任务"], button[title="Add to task"]');
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(plusClicked, "The composer add menu was unavailable.");
  await ctx.clickText("使用模板", { selector: 'button', timeoutMs: 15_000 });
  await ctx.waitFor(`Boolean(document.querySelector('[role="dialog"] input[placeholder="搜索…"], [role="dialog"] input[placeholder="Search…"]'))`, {
    timeoutMs: 30_000,
    label: "current conversation template market",
  });
  await ctx.fill('[role="dialog"] input[placeholder="搜索…"], [role="dialog"] input[placeholder="Search…"]', "Investor Pitch Deck");
  await ctx.waitFor(`document.querySelector('[role="dialog"]')?.innerText.includes("Investor Pitch Deck")`, {
    timeoutMs: 30_000,
    label: "pitch template result",
  });
  const used = await ctx.eval(`(() => {
    const article = [...document.querySelectorAll('[role="dialog"] article')]
      .find((item) => item.querySelector('h3')?.textContent?.includes('Investor Pitch Deck'));
    const button = [...(article?.querySelectorAll('button') || [])]
      .find((item) => /^(?:使用|Use)$/.test(item.textContent?.trim() || ''));
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(used, "The installed Investor Pitch Deck action was unavailable.");
  await ctx.waitFor(`document.querySelector('[data-testid="template-apply-dialog"]')?.innerText.includes("Investor Pitch Deck")`, {
    timeoutMs: 45_000,
    label: "second independent template brief",
  });
}

export default {
  id: "multi-template-conversation",
  title: "One conversation owns multiple isolated template instances",
  kind: "user-facing",
  steps: [
    {
      name: "Use another template without creating another task",
      run: async (ctx) => {
        await createTemplateConversation(ctx);
        const sessionId = await ctx.eval(`sessionStorage.getItem("fraimz-multi-template-session-id") || ""`);
        try {
          await ctx.prove("A second template opens in the same conversation and receives its own artifact directory", {
            voiceover: VOICEOVER,
            action: async () => { await openCurrentConversationTemplates(ctx); },
            assert: async () => {
              await ctx.expectNoText("在新任务中使用此模板？");
              const state = await ctx.eval(`(async () => {
                const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop("ipolloworkServerInfo");
                const token = (info.ownerToken || info.clientToken || "").trim();
                const workspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || "";
                const conversationId = sessionStorage.getItem("fraimz-multi-template-session-id") || "";
                const response = await fetch(info.baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/template-sessions", {
                  headers: { Authorization: "Bearer " + token },
                });
                const body = await response.json();
                const sessions = (body.items || []).filter((item) => item.sessionId === conversationId || item.sessionId.startsWith(conversationId + "-artifact-"));
                return {
                  routeSessionId: location.hash.match(/\\/session\\/([^/?#]+)/)?.[1] || "",
                  conversationId,
                  sessions: sessions.map((item) => ({ sessionId: item.sessionId, entry: item.state?.entry, title: item.manifest?.title })),
                };
              })()`, { awaitPromise: true });
              ctx.assert(state.routeSessionId === state.conversationId, `The visible conversation changed: ${JSON.stringify(state)}`);
              ctx.assert(state.sessions.some((item) => item.sessionId.endsWith("-artifact-site") && item.title === "SaaS Landing"), `The first template instance is missing: ${JSON.stringify(state)}`);
              ctx.assert(state.sessions.some((item) => item.sessionId.endsWith("-artifact-slides") && item.title === "Investor Pitch Deck"), `The second template instance is missing: ${JSON.stringify(state)}`);
              ctx.assert(new Set(state.sessions.map((item) => item.entry?.split('/').slice(0, -1).join('/'))).size === state.sessions.length, `Template artifact directories overlap: ${JSON.stringify(state)}`);
            },
            screenshot: {
              name: "same-conversation-second-template",
              requireText: ["Investor Pitch Deck", "Design brief"],
              rejectText: ["在新任务中使用此模板？"],
              hashIncludes: "/session/",
            },
          });
        } finally {
          if (sessionId) await ctx.control("session.archive", { sessionId, archived: true }).catch(() => undefined);
          await ctx.eval(`sessionStorage.removeItem("fraimz-multi-template-session-id")`);
        }
      },
    },
  ],
};
