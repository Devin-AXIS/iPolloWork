// Real approval UI, interaction hook and permission memory; only engine I/O is
// simulated. No command runs and no real conversation receives a broader grant.
async function mountFixture(storageKey) {
  const modules = performance.getEntriesByType("resource").map((entry) => entry.name);
  const reactUrl = modules.find((url) => /\/react\.js\?/.test(url));
  const domUrl = modules.find((url) => /\/react-dom_client\.js\?/.test(url));
  if (!reactUrl || !domUrl) throw new Error("React development modules are not available");
  const { default: React } = await import(reactUrl);
  const { default: ReactDOMClient } = await import(domUrl);
  const revision = Date.now();
  const { PermissionApprovalPanel } = await import(`/src/react-app/domains/session/chat/permission-approval-modal.tsx?fraimz=${revision}`);
  const { withSessionPermissionMemory } = await import(`/src/react-app/domains/session/engine/conversation-engine.ts?fraimz=${revision}`);
  const { useSessionInteractions } = await import(`/src/react-app/domains/session/sync/use-session-interactions.ts?fraimz=${revision}`);
  const { seedPermissionState, permissionKey, questionKey, todoKey } = await import("/src/react-app/domains/session/sync/session-sync.ts");
  const { getReactQueryClient } = await import("/src/react-app/infra/query-client.ts");
  const { useSessionActivityStore } = await import("/src/react-app/domains/session/status/session-activity-store.ts");
  const { t } = await import("/src/i18n/index.ts");
  const workspaceId = storageKey;
  const firstSession = "permission-proof-a";
  const secondSession = "permission-proof-b";
  const receipts = [];
  const pending = [];
  const storage = {
    getItem: () => localStorage.getItem(storageKey),
    setItem: (_key, value) => localStorage.setItem(storageKey, value),
    removeItem: () => localStorage.removeItem(storageKey),
  };
  const permission = (id, kind, sessionId = firstSession) => ({
    id, kind, sessionId, resources: [`模拟 ${kind} 请求（不会执行）`],
    remember: [], metadata: {}, receivedAt: Date.now(), native: null,
  });
  pending.push(permission("first-shell", "shell"), permission("queued-mcp", "mcp"));
  let listener;
  let connection;
  let showOtherTask = false;
  let controller;
  function reconnect() {
    controller?.abort();
    controller = new AbortController();
    connection = withSessionPermissionMemory({
      id: "fraimz-permission-fixture",
      connect: () => ({
        async subscribe(input) { listener = input.onEvent; },
        async listPermissions({ sessionId }) { return pending.filter((item) => item.sessionId === sessionId); },
        async replyPermission({ permission: item, reply }) {
          receipts.push({ id: item.id, kind: item.kind, sessionId: item.sessionId, reply });
          const index = pending.findIndex((entry) => entry.id === item.id);
          if (index >= 0) pending.splice(index, 1);
        },
        async listQuestions() { return []; },
      }),
    }, storage).connect({ baseUrl: "http://permission-fixture.invalid", workspaceId });
    void connection.subscribe({
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "permission.asked") {
          seedPermissionState(workspaceId, event.permission.sessionId, pending);
        }
      },
    });
  }
  reconnect();
  document.getElementById("fraimz-permission-fixture")?.remove();
  const host = document.createElement("section");
  host.id = "fraimz-permission-fixture";
  host.className = "fixed inset-0 z-40 overflow-auto bg-background p-10 text-foreground";
  document.body.append(host);
  const root = ReactDOMClient.createRoot(host);
  function Case({ sessionId, title }) {
    const interactions = useSessionInteractions({ connection, workspaceId, sessionId, workspaceRoot: "" });
    return React.createElement("section", { "data-proof-session": sessionId, className: "rounded-xl border mb-6 overflow-hidden" },
      React.createElement("h2", { className: "px-4 py-3 text-lg font-medium border-b" }, title),
      interactions.activePermission
        ? React.createElement(PermissionApprovalPanel, { permission: interactions.activePermission, respondPermission: interactions.respondPermission, busy: interactions.permissionReplyBusy })
        : React.createElement("p", { className: "p-4 text-emerald-600", "data-proof-approved": sessionId }, "没有待确认的权限请求"));
  }
  function Fixture() {
    return React.createElement("div", { className: "mx-auto max-w-4xl" },
      React.createElement("h1", { className: "text-2xl font-semibold mb-2" }, "当前会话：一次选择，全部权限"),
      React.createElement("p", { className: "mb-8 text-muted-foreground" }, "回归验证 · 真实权限组件与状态逻辑，模拟引擎请求，不执行命令"),
      React.createElement(Case, { sessionId: firstSession, title: "会话 A" }),
      React.createElement("ul", { className: "mb-8 space-y-2", "data-proof-receipts": true }, receipts.map((item) =>
        React.createElement("li", { key: item.id }, `${item.id} · ${item.kind} → ${item.reply}`))),
      showOtherTask ? React.createElement(Case, { sessionId: secondSession, title: "会话 B（仍需单独授权）" }) : null);
  }
  const render = () => root.render(React.createElement(Fixture));
  render();
  window.__permissionProof = {
    labels: { once: t("session.allow_once"), always: t("session.allow_for_session") },
    receipts,
    async restoreAndRequest() {
      // A new adapter has no in-memory grants; restore from browser storage.
      pending.push(permission("restored-shell", "shell"), permission("restored-mcp", "mcp"), permission("restored-file", "edit"));
      reconnect();
      const remaining = await connection.listPermissions({ sessionId: firstSession });
      seedPermissionState(workspaceId, firstSession, remaining);
      const live = permission("live-directory", "external_directory");
      pending.push(live);
      listener({ type: "permission.asked", permission: live });
      const other = permission("other-task-mcp", "mcp", secondSession);
      pending.push(other);
      listener({ type: "permission.asked", permission: other });
      showOtherTask = true;
      render();
    },
    cleanup() {
      controller.abort();
      root.unmount();
      host.remove();
      localStorage.removeItem(storageKey);
      for (const sessionId of [firstSession, secondSession]) {
        for (const key of [permissionKey, questionKey, todoKey]) getReactQueryClient().removeQueries({ queryKey: key(workspaceId, sessionId), exact: true });
        useSessionActivityStore.getState().removeSession(workspaceId, sessionId);
      }
      delete window.__permissionProof;
    },
  };
}

export default {
  id: "session-permission-all",
  title: "Task-wide permission choice covers MCP, shell and files without crossing tasks",
  kind: "internal",
  steps: [{
    name: "Choose task-wide permission once, restore it, and retain task isolation",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
      const storageKey = `ipollowork.eval.permission-proof.${Date.now()}`;
      try {
        await ctx.eval(`(${mountFixture.toString()})(${JSON.stringify(storageKey)})`, { awaitPromise: true });
        await ctx.waitFor("Boolean(window.__permissionProof)");
        const labels = await ctx.eval("window.__permissionProof.labels");
        await ctx.prove("The approval menu explicitly offers all permissions for this conversation only", {
          voiceover: "始终允许的说明明确覆盖本会话的 MCP、Shell 和文件权限，不影响其他会话。",
          action: async () => {
            await ctx.trustedClick(`#fraimz-permission-fixture [data-proof-session="permission-proof-a"] button[aria-label=${JSON.stringify(labels.once)}]`);
          },
          assert: async () => {
            await ctx.waitForText(labels.always);
            ctx.assert((await ctx.eval("document.body.innerText")).includes("MCP"), "The permission scope must be stated before approval.");
          },
          screenshot: { name: "session-wide-permission-choice", requireText: [labels.always, "MCP", "Shell"] },
        });
        await ctx.prove("One choice clears different permission kinds and survives reconnection while another task still asks", {
          voiceover: "在会话 A 选择一次后，排队和后续的不同权限都能继续；重新连接仍然有效，会话 B 则继续单独询问。",
          action: async () => {
            await ctx.trustedClick('[data-slot="dropdown-menu-content"] [role="menuitem"]:last-child');
            await ctx.waitFor(`window.__permissionProof.receipts.length === 2 && Boolean(document.querySelector('[data-proof-approved="permission-proof-a"]'))`, { label: "initial and queued approvals cleared" });
            await ctx.eval("window.__permissionProof.restoreAndRequest()", { awaitPromise: true });
          },
          assert: async () => {
            await ctx.waitFor("window.__permissionProof.receipts.length === 6", { label: "all first-task permissions approved" });
            const receipts = await ctx.eval("window.__permissionProof.receipts");
            ctx.assert(receipts.every((item) => item.sessionId === "permission-proof-a" && item.reply === "once"), "Native grants must stay one-shot and must not cross tasks.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-proof-session="permission-proof-b"] button[aria-label]'))`, { label: "other task still asks" });
            ctx.assert(await ctx.eval(`Boolean(document.querySelector('[data-proof-approved="permission-proof-a"]'))`), "No approval panel should remain for task A.");
            await ctx.waitForText("restored-mcp");
            await ctx.waitForText("会话 B（仍需单独授权）");
          },
          screenshot: { name: "session-wide-permission-isolation", requireText: ["会话 B（仍需单独授权）", "restored-mcp", "restored-shell", "restored-file"] },
        });
      } finally {
        await ctx.eval("window.__permissionProof?.cleanup()").catch(() => {});
        await ctx.eval(`document.getElementById('fraimz-permission-fixture')?.remove(); localStorage.removeItem(${JSON.stringify(storageKey)})`).catch(() => {});
      }
    },
  }],
};
