import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("work-context-isolation");

let enterpriseId = "";
let enterpriseName = "";
let personalWorkspaceId = "";
let enterpriseWorkspaceId = "";
let personalSessionIds = [];
let personalActiveSessionId = "";
let enterpriseSessionIds = [];
let sawSwitchLoader = false;

function clickButton(pattern) {
  return `(() => {
    const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
      ${pattern}.test((candidate.textContent || "").replace(/\\s+/g, " ").trim())
    );
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openAccount(ctx) {
  await ctx.navigateHash("/settings/cloud-account");
  await ctx.waitFor(
    `document.body.innerText.includes("工作身份") || document.body.innerText.includes("Work identity")`,
    { timeoutMs: 30_000, label: "single Work identity selector" },
  );
}

async function returnToChat(ctx) {
  if (!await ctx.eval(`location.hash.includes("/session")`)) {
    const clicked = await ctx.eval(clickButton("/^(?:返回应用|Back to app)$/u"));
    ctx.assert(clicked === true, "Expected the Back to app button.");
  }
  await ctx.waitFor(`location.hash.includes("/session")`, {
    timeoutMs: 30_000,
    label: "chat route",
  });
  await ctx.waitFor(`!document.querySelector('[data-testid="startup-logo-animation"]')`, {
    timeoutMs: 30_000,
    label: "context switch completed",
  });
}

async function currentSessions(ctx, options = {}) {
  const requiredWorkspaceName = options.requiredWorkspaceName || "";
  const forbiddenWorkspaceName = options.forbiddenWorkspaceName || "";
  await ctx.waitFor(
    `(() => {
      const route = window.__ipollowork?.slice?.("route");
      if (!route || route.loading) return false;
      const selectedWorkspaceId = route.selectedWorkspaceId || "";
      return Boolean(
        selectedWorkspaceId
        && route.sessionsByWorkspaceId
        && Object.prototype.hasOwnProperty.call(route.sessionsByWorkspaceId, selectedWorkspaceId)
        && window.__ipolloworkControl.listActions().some((action) =>
          action.id === "session.list_sessions" && !action.busy && !action.disabled
        )
      );
    })()`,
    { timeoutMs: 30_000, label: "session list updated for active workspace" },
  );
  const response = await ctx.eval(
    `window.__ipolloworkControl.execute("session.list_sessions")`,
    { awaitPromise: true },
  );
  ctx.assert(response?.ok === true, `Could not read the active session list: ${response?.error || "unknown error"}`);
  const sessions = response.result || [];
  const activeSessionId = await ctx.eval(`location.hash.match(/\\/session\\/(ses_[A-Za-z0-9]+)/)?.[1] || ""`);
  ctx.assert(
    !activeSessionId || sessions.some((session) => session.sessionId === activeSessionId),
    "The active session must belong to the visible work context.",
  );
  ctx.assert(
    !requiredWorkspaceName || sessions.every((session) => session.workspace === requiredWorkspaceName),
    `Every visible session must belong to ${requiredWorkspaceName}.`,
  );
  ctx.assert(
    !forbiddenWorkspaceName || sessions.every((session) => session.workspace !== forbiddenWorkspaceName),
    `No visible session may belong to ${forbiddenWorkspaceName}.`,
  );
  return sessions;
}

export default {
  id: "work-context-isolation",
  title: "Personal and every Enterprise are fully isolated work contexts",
  kind: "user-facing",
  spec: "evals/voiceovers/work-context-isolation.md",
  steps: [
    {
      name: "Setup",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop)", {
          timeoutMs: 60_000,
          label: "desktop app ready",
        });
        const connection = await ctx.eval(`(() => {
          try {
            const items = JSON.parse(localStorage.getItem("ipollowork.enterprise-connections.v1") || "[]");
            const first = items[0];
            return first ? { id: first.id, name: first.name } : null;
          } catch { return null; }
        })()`);
        ctx.assert(Boolean(connection?.id), "Expected a joined Enterprise for the isolation proof.");
        enterpriseId = connection.id;
        enterpriseName = connection.name;

        await openAccount(ctx);
        const clicked = await ctx.eval(clickButton("/^(?:个人|Personal)/u"));
        ctx.assert(clicked === true, "Expected the Personal work identity button.");
        await ctx.waitFor(`localStorage.getItem("ipollowork.work-context.v1") === "personal"`, {
          timeoutMs: 30_000,
          label: "Personal work context active",
        });
        await returnToChat(ctx);
      },
    },
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("Personal shows only Personal workspaces and chat history", {
          voiceover: vo[0],
          assert: async () => {
            const state = await ctx.eval(`(async () => {
              const bootstrap = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop("workspaceBootstrap");
              const routeWorkspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || "";
              const personal = (bootstrap.workspaces || []).filter((workspace) => !workspace.workContextId || workspace.workContextId === "personal");
              return { routeWorkspaceId, personalIds: personal.map((workspace) => workspace.id) };
            })()`, { awaitPromise: true });
            personalWorkspaceId = state.routeWorkspaceId;
            personalActiveSessionId = await ctx.eval(`location.hash.match(/\\/session\\/(ses_[A-Za-z0-9]+)/)?.[1] || ""`);
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions().some((action) => action.id === "session.list_sessions")`,
              { timeoutMs: 30_000, label: "Personal session list" },
            );
            personalSessionIds = (await currentSessions(ctx, { forbiddenWorkspaceName: enterpriseName })).map((session) => session.sessionId);
            ctx.assert(state.personalIds.length === 1, "Expected exactly one Personal workspace.");
            ctx.assert(state.personalIds.includes(personalWorkspaceId), "Personal route must use a Personal workspace.");
          },
          screenshot: {
            name: "work-context-personal",
            requireText: ["新建对话", "模版", "扩展"],
            rejectText: ["创建团队", "Request failed with 404", "Workspace was not found", "Session was not found"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("Switching to Enterprise replaces the whole workspace and chat sidebar after the branded transition", {
          voiceover: vo[1],
          action: async () => {
            await openAccount(ctx);
            const clicked = await ctx.eval(clickButton(`/${escapeRegExp(enterpriseName)}/u`));
            ctx.assert(clicked === true, "Expected the joined Enterprise work identity button.");
            sawSwitchLoader = Boolean(await ctx.waitFor(
              `Boolean(document.querySelector('[data-testid="startup-logo-animation"]'))`,
              { timeoutMs: 3_000, label: "branded context switch loader" },
            ));
            await ctx.waitFor(
              `localStorage.getItem("ipollowork.work-context.v1") === ${JSON.stringify(`enterprise:${enterpriseId}`)}`,
              { timeoutMs: 30_000, label: "Enterprise work context active" },
            );
            await returnToChat(ctx);
          },
          assert: async () => {
            const state = await ctx.eval(`(async () => {
              const bootstrap = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop("workspaceBootstrap");
              const routeWorkspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || "";
              const contextId = ${JSON.stringify(`enterprise:${enterpriseId}`)};
              const enterprise = (bootstrap.workspaces || []).filter((workspace) => workspace.workContextId === contextId);
              return { routeWorkspaceId, enterpriseIds: enterprise.map((workspace) => workspace.id) };
            })()`, { awaitPromise: true });
            enterpriseWorkspaceId = state.routeWorkspaceId;
            enterpriseSessionIds = (await currentSessions(ctx, { requiredWorkspaceName: enterpriseName })).map((session) => session.sessionId);
            const enterpriseRouteEvidence = await ctx.eval(`(() => {
              const route = window.__ipollowork?.slice?.("route");
              return {
                loading: route?.loading,
                selectedWorkspaceId: route?.selectedWorkspaceId,
                sessionsByWorkspaceId: route?.sessionsByWorkspaceId,
              };
            })()`);
            ctx.assert(sawSwitchLoader, "The iPolloWork transition loader must be visible while switching.");
            ctx.assert(state.enterpriseIds.length === 1, "Expected one dedicated Enterprise workspace.");
            ctx.assert(state.enterpriseIds.includes(enterpriseWorkspaceId), "Enterprise route must use its dedicated workspace.");
            ctx.assert(enterpriseWorkspaceId !== personalWorkspaceId, "Personal and Enterprise must not share a workspace.");
            const leakedPersonalSessionIds = enterpriseSessionIds.filter((id) => personalSessionIds.includes(id));
            ctx.assert(
              leakedPersonalSessionIds.length === 0,
              `Enterprise must not render a Personal chat in its sidebar (${leakedPersonalSessionIds.join(", ")}; route=${JSON.stringify(enterpriseRouteEvidence)}).`,
            );
          },
          screenshot: {
            name: "work-context-enterprise",
            requireText: ["Enterprise", "新建对话", "模版", "扩展"],
            rejectText: ["创建团队", "Request failed with 404", "Workspace was not found", "Session was not found"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        let sawExtensionsScope = false;
        let sawTemplatesScope = false;
        await ctx.prove("Enterprise extensions, templates, and memory use the Enterprise context instead of Personal data", {
          voiceover: vo[2],
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await ctx.waitFor(`document.body.innerText.includes("资源来源") && document.body.innerText.includes("个人")`, {
              timeoutMs: 30_000,
              label: "Enterprise Extensions resource source",
            });
            sawExtensionsScope = true;
            await returnToChat(ctx);
            const templatesClicked = await ctx.eval(clickButton("/^(?:模版|Templates)$/u"));
            ctx.assert(templatesClicked === true, "Expected the Templates button.");
            await ctx.waitFor(
              `Boolean(document.querySelector('[role="dialog"]')) && document.body.innerText.includes("资源来源")`,
              { timeoutMs: 30_000, label: "Enterprise Templates resource source" },
            );
            sawTemplatesScope = true;
            await ctx.eval(`(() => {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              return true;
            })()`);
            await ctx.navigateHash("/settings/memory");
            await ctx.waitFor(
              `document.body.innerText.includes("企业记忆与个人空间完全独立")`,
              { timeoutMs: 30_000, label: "isolated Enterprise memory state" },
            );
          },
          assert: async () => {
            ctx.assert(sawExtensionsScope, "Extensions must expose the Enterprise resource source.");
            ctx.assert(sawTemplatesScope, "Templates must expose the Enterprise resource source.");
            await ctx.expectNoText("Request failed with 404");
            await ctx.expectText("企业记忆与个人空间完全独立");
          },
          screenshot: {
            name: "work-context-enterprise-memory",
            requireText: ["记忆", "企业记忆与个人空间完全独立"],
            rejectText: ["Request failed with 404"],
            hashIncludes: "/settings/memory",
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Returning to Personal restores its workspace and leaves only one Work identity selector", {
          voiceover: vo[3],
          action: async () => {
            await openAccount(ctx);
            const accountState = await ctx.eval(`(() => ({
              personalButtons: Array.from(document.querySelectorAll("button")).filter((button) => /^(?:个人|Personal)/u.test((button.textContent || "").trim())).length,
              enterpriseButtons: Array.from(document.querySelectorAll("button")).filter((button) => {
                const text = button.textContent || "";
                return text.includes(${JSON.stringify(enterpriseName)}) && /member|成员/iu.test(text);
              }).length,
              body: document.body.innerText,
            }))()`);
            ctx.assert(accountState.personalButtons === 1, "Expected exactly one Personal work identity entry.");
            ctx.assert(accountState.enterpriseButtons === 1, "Expected exactly one joined Enterprise work identity entry.");
            ctx.assert(!accountState.body.includes("创建团队"), "The removed team creation UI must not return.");
            ctx.assert(!accountState.body.includes("工作站"), "The removed workstation concept must not return.");

            const clicked = await ctx.eval(clickButton("/^(?:个人|Personal)/u"));
            ctx.assert(clicked === true, "Expected the Personal work identity button.");
            await ctx.waitFor(`localStorage.getItem("ipollowork.work-context.v1") === "personal"`, {
              timeoutMs: 30_000,
              label: "Personal restored",
            });
            await returnToChat(ctx);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              routeWorkspaceId: location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || "",
              routeSessionId: location.hash.match(/\\/session\\/(ses_[A-Za-z0-9]+)/)?.[1] || "",
              activeContext: localStorage.getItem("ipollowork.work-context.v1"),
              hasLegacyContext: localStorage.getItem("ipollowork.enterprise-active.v1") !== null,
              hasLegacyWorkspaceMap: localStorage.getItem("ipollowork.work-context-workspaces.v1") !== null,
              hasLegacyOrganizationMap: localStorage.getItem("ipollowork.cloud.organizationWorkspaces.v1") !== null,
              hasLegacyWorkspaceOrder: localStorage.getItem("ipollowork.react.workspaceOrder") !== null,
            }))()`);
            const restoredSessionIds = (await currentSessions(ctx, { forbiddenWorkspaceName: enterpriseName })).map((session) => session.sessionId);
            ctx.assert(state.activeContext === "personal", "Personal must be the active Work Context.");
            ctx.assert(state.routeWorkspaceId === personalWorkspaceId, "Personal must restore its previous workspace.");
            ctx.assert(state.routeWorkspaceId !== enterpriseWorkspaceId, "Enterprise workspace must stay hidden in Personal.");
            ctx.assert(state.routeSessionId === personalActiveSessionId, "Personal must restore its previous active chat.");
            ctx.assert(!state.hasLegacyContext, "The legacy active Enterprise key must be removed.");
            ctx.assert(!state.hasLegacyWorkspaceMap, "The legacy context-to-workspace map must be removed.");
            ctx.assert(!state.hasLegacyOrganizationMap, "The legacy organization-to-workspace map must be removed.");
            ctx.assert(!state.hasLegacyWorkspaceOrder, "The legacy workspace order must be removed.");
            ctx.assert(
              restoredSessionIds.every((id) => !enterpriseSessionIds.includes(id)),
              "Returning to Personal must not render an Enterprise chat.",
            );
          },
          screenshot: {
            name: "work-context-personal-restored",
            requireText: ["新建对话", "模版", "扩展"],
            rejectText: ["创建团队", "Request failed with 404"],
          },
        });
      },
    },
  ],
};
