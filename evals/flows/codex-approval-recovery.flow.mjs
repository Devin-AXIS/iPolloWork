// Start support/codex-approval-fixture.mjs first. Real runtime, adapter and UI;
// only the Codex child is simulated so this proof cannot execute a paid tool.
async function mount() {
  const modules = performance.getEntriesByType("resource").map((entry) => entry.name);
  const { default: React } = await import(modules.find((url) => /\/react\.js\?/.test(url)));
  const { default: ReactDOM } = await import(modules.find((url) => /\/react-dom_client\.js\?/.test(url)));
  const { PermissionApprovalPanel } = await import("/src/react-app/domains/session/chat/permission-approval-modal.tsx");
  const { codexHarnessConversationEngineAdapter: adapter } = await import("/src/react-app/domains/session/engine/codex-harness-conversation-engine.ts");
  const { useSessionInteractions } = await import("/src/react-app/domains/session/sync/use-session-interactions.ts");
  const { seedPermissionState, permissionKey, questionKey, todoKey } = await import("/src/react-app/domains/session/sync/session-sync.ts");
  const { getReactQueryClient } = await import("/src/react-app/infra/query-client.ts");
  const { useSessionActivityStore, getSessionActivityStatusLabel } = await import("/src/react-app/domains/session/status/session-activity-store.ts");
  const { t } = await import("/src/i18n/index.ts");
  const workspaceId = "approval-proof";
  let sessionId = workspaceId;
  let connection;
  let abort;
  let subscription;
  let revision = 0;
  const host = document.createElement("div");
  host.id = "approval-recovery-proof";
  host.className = "fixed inset-0 z-50 bg-background p-10 text-foreground";
  document.body.append(host);
  const root = ReactDOM.createRoot(host);
  function View() {
    const interactions = useSessionInteractions({ connection, workspaceId, sessionId, workspaceRoot: "" });
    const status = useSessionActivityStore((state) => state.statusesByWorkspaceId[workspaceId]?.[sessionId] ?? "idle");
    return React.createElement("div", { className: "mx-auto max-w-3xl space-y-4" },
      React.createElement("h1", { className: "text-xl font-medium" }, "图片编辑 · 授权恢复验证"),
      React.createElement("p", { className: "text-muted-foreground" }, "真实服务端、事件通道和授权面板；模拟 Codex 请求，不执行生成。"),
      React.createElement("p", { className: "text-sm text-muted-foreground" }, `任务：${sessionId} · 第 ${revision} 次连接`),
      React.createElement("p", { "data-status": status }, getSessionActivityStatusLabel(status)),
      React.createElement("div", { className: "rounded-xl border overflow-hidden", "data-permission-count": interactions.pendingPermissions?.length ?? (interactions.activePermission ? 1 : 0) },
        interactions.activePermission
          ? React.createElement(PermissionApprovalPanel, { permission: interactions.activePermission, respondPermission: interactions.respondPermission, busy: interactions.permissionReplyBusy })
          : React.createElement("p", { className: "p-4", "data-no-approval": true }, "没有待确认的授权请求")));
  }
  const render = () => root.render(React.createElement(View, { key: `${sessionId}:${revision}` }));
  async function connect() {
    abort?.abort();
    await subscription?.catch(() => {});
    connection = adapter.connect({ baseUrl: "http://127.0.0.1:5275", serverBaseUrl: "http://127.0.0.1:5275", workspaceId, token: "fixture" });
    abort = new AbortController();
    subscription = connection.subscribe({ signal: abort.signal, onEvent: async (event) => {
      if (event.type === "permission.asked" || event.type === "permission.replied") {
        seedPermissionState(workspaceId, workspaceId, await connection.listPermissions({ sessionId: workspaceId }));
      }
    } });
    revision++;
    render();
  }
  await connect();
  window.__approvalRecovery = {
    deny: t("session.deny"),
    async reconnect() {
      getReactQueryClient().removeQueries({ queryKey: permissionKey(workspaceId, workspaceId), exact: true });
      useSessionActivityStore.getState().removeSession(workspaceId, workspaceId);
      await connect();
    },
    switchTask(other) { sessionId = other ? "other-proof-task" : workspaceId; render(); },
    async cleanup() {
      abort.abort(); await subscription.catch(() => {}); root.unmount(); host.remove();
      for (const id of [workspaceId, "other-proof-task"]) {
        for (const key of [permissionKey, questionKey, todoKey]) getReactQueryClient().removeQueries({ queryKey: key(workspaceId, id), exact: true });
        useSessionActivityStore.getState().removeSession(workspaceId, id);
      }
      delete window.__approvalRecovery;
    },
  };
}
export default {
  id: "codex-approval-recovery",
  title: "Unanswered image-edit approval survives disconnection and can be declined",
  kind: "internal",
  steps: [{ name: "Recover authorization without executing an image generation", async run(ctx) {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30000 });
    // Ask before there is any SSE subscriber: the original lost-event failure.
    await fetch("http://127.0.0.1:5275/ask", { method: "POST" });
    try {
      await ctx.prove("A request emitted before the page connects is visible as waiting for authorization", {
        action: () => ctx.eval(`(${mount.toString()})()`, { awaitPromise: true }),
        assert: async () => { await ctx.waitFor("document.querySelector('#approval-recovery-proof [data-status=waiting]') && document.querySelector('#approval-recovery-proof').innerText.includes('Allow image edit?')"); },
        screenshot: { name: "recovered-approval", requireText: ["Allow image edit?"] },
      });
      await ctx.prove("Switching tasks does not show another task's request and returning restores it", {
        action: async () => {
          await ctx.eval("window.__approvalRecovery.switchTask(true)");
          await ctx.waitFor("Boolean(document.querySelector('#approval-recovery-proof [data-no-approval]'))");
        },
        assert: async () => { await ctx.waitFor("Boolean(document.querySelector('#approval-recovery-proof [data-no-approval]'))"); },
        screenshot: { name: "returned-to-edit" },
      });
      await ctx.prove("Discarding the frontend connection and cached request still restores exactly one approval", {
        action: async () => {
          await ctx.eval("window.__approvalRecovery.switchTask(false)");
          await ctx.waitFor("Boolean(document.querySelector('#approval-recovery-proof [data-status=waiting]'))");
          await ctx.eval("window.__approvalRecovery.reconnect()", { awaitPromise: true });
        },
        assert: async () => { await ctx.waitFor("Boolean(document.querySelector('#approval-recovery-proof [data-status=waiting]') && document.querySelector('#approval-recovery-proof [data-permission-count=\"1\"]'))"); },
        screenshot: { name: "reconnected-approval" },
      });
      await ctx.prove("Reject reaches the runtime and answered requests never reappear after reconnect", {
        action: async () => {
          const deny = await ctx.eval("window.__approvalRecovery.deny");
          await ctx.clickText(deny, { selector: "#approval-recovery-proof button" });
          await ctx.waitFor("Boolean(document.querySelector('#approval-recovery-proof [data-no-approval]'))");
          await ctx.eval("window.__approvalRecovery.reconnect()", { awaitPromise: true });
        },
        assert: async () => {
          const receipts = await fetch("http://127.0.0.1:5275/receipts").then((r) => r.json());
          ctx.assert(receipts.some((item) => item.rpcId === 61 && item.result.action === "decline"), "Runtime received explicit decline");
          await ctx.waitFor("Boolean(document.querySelector('#approval-recovery-proof [data-status=idle]'))");
          ctx.assert(await ctx.eval("Boolean(document.querySelector('#approval-recovery-proof [data-no-approval]'))"), "No stale approval remains");
        },
        screenshot: { name: "declined-and-cleared" },
      });
    } finally { await ctx.eval("window.__approvalRecovery?.cleanup()", { awaitPromise: true }); }
  } }],
};
