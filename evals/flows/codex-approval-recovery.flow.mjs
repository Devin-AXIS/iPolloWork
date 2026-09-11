// Real confirmation components and native event mapper; isolated fixture I/O.
// No real task is approved, interrupted, or submitted by this proof.
async function mountConfirmationFixture() {
  const modules = performance.getEntriesByType("resource").map(entry => entry.name);
  const reactUrl = modules.find(url => /\/react\.js\?/.test(url));
  const domUrl = modules.find(url => /\/react-dom_client\.js\?/.test(url));
  if (!reactUrl || !domUrl) throw new Error("React development modules are not available");
  const { default: React } = await import(reactUrl);
  const { default: ReactDOMClient } = await import(domUrl);
  const { PermissionApprovalPanel, PendingConfirmationNotice } = await import("/src/react-app/domains/session/chat/permission-approval-modal.tsx");
  const { QuestionPanel } = await import("/src/react-app/domains/session/modals/question-modal.tsx");
  const { createCodexLiveState, mapCodexHarnessEvent } = await import("/src/react-app/domains/session/engine/codex-harness-conversation-mapper.ts");
  const { t } = await import("/src/i18n/index.ts");
  const host = document.createElement("section");
  host.id = "fraimz-confirmation-recovery";
  host.className = "fixed inset-0 z-40 overflow-auto bg-background p-6 text-foreground";
  document.body.append(host);
  const root = ReactDOMClient.createRoot(host);
  const receipts = [];
  const labels = { approval: t("session.waiting_approval"), input: t("session.waiting_input"), stop: t("session.stop_waiting_run"), deny: t("session.deny"), once: t("session.allow_once") };
  let restored = false;
  let rejected = false;
  const state = createCodexLiveState();
  const permission = mapCodexHarnessEvent({ type: "request", id: "fixture-approval", method: "item/commandExecution/requestApproval", params: {
    threadId: "fixture-thread", turnId: "fixture-turn", command: "Get-Content brief.md", cwd: "C:/isolated-proof", reason: "读取视频简报（模拟请求，不会执行命令）",
  } }, state)[0].permission;
  const question = mapCodexHarnessEvent({ type: "request", id: "fixture-input", method: "item/tool/requestUserInput", params: {
    threadId: "fixture-thread", questions: [{ id: "model", header: "素材模型", question: "请选择用于素材生成的已配置模型（模拟）", options: [{ label: "已配置模型 A", description: "仅验证输入提示，不生成素材" }], isOther: true }],
  } }, state)[0].question;
  const render = () => root.render(React.createElement("div", { className: "mx-auto max-w-3xl space-y-5" },
    React.createElement("h1", { className: "text-lg font-semibold" }, "确认请求恢复验证（隔离用例）"),
    React.createElement("p", { className: "text-sm text-muted-foreground" }, "真实界面组件 · 模拟引擎请求 · 不操作当前任务"),
    !restored ? React.createElement(PendingConfirmationNotice, { waitingFor: "approval", onStop: () => receipts.push({ type: "stop" }) }) :
      React.createElement(React.Fragment, null,
        React.createElement("section", { "data-proof-approval": true, className: "rounded-xl border" },
          React.createElement("h2", { className: "px-4 py-3 text-sm font-medium" }, labels.approval),
          rejected ? React.createElement("p", { className: "p-4" }, "已拒绝模拟操作") : React.createElement(PermissionApprovalPanel, {
            permission, respondPermission: (id, reply) => { receipts.push({ id, reply }); rejected = reply === "reject"; render(); },
          })),
        React.createElement("section", { "data-proof-input": true, className: "rounded-xl border" },
          React.createElement("h2", { className: "px-4 py-3 text-sm font-medium" }, labels.input),
          React.createElement(QuestionPanel, { questions: question.questions, busy: false, onReply: answers => receipts.push({ type: "input", answers }) }))),
    !restored ? React.createElement("button", { type: "button", "data-proof-reconnect": true, className: "rounded-lg border px-4 py-2 text-sm", onClick: () => { restored = true; render(); } }, "恢复模拟连接") : null,
  ));
  window.__confirmationProof = { receipts, labels, cleanup() { root.unmount(); host.remove(); delete window.__confirmationProof; } };
  render();
}

export default {
  id: "codex-approval-recovery",
  title: "Waiting confirmations stay visible and restored requests still require a user decision",
  kind: "internal",
  preserveTheme: true,
  steps: [{
    name: "Missing and restored confirmation prompts",
    run: async ctx => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)");
      try {
        await ctx.eval(`(${mountConfirmationFixture.toString()})()`, { awaitPromise: true });
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"pending-confirmation-notice\"]'))");
        const labels = await ctx.eval("window.__confirmationProof.labels");
        await ctx.prove("缺失确认详情时明确提示等待，而不是让用户一直看转圈", {
          voiceover: "任务等待确认时会说明暂停原因；旧请求详情没有恢复时，用户可以主动停止任务，不会自动批准。",
          action: async () => {},
          assert: async () => {
            ctx.assert(await ctx.eval("window.__confirmationProof.receipts.length === 0"), "Mounting a notice must not stop or approve a task");
            ctx.assert(await ctx.eval("!document.querySelector('[data-testid=\"pending-confirmation-notice\"] .animate-spin')"), "A confirmation wait is not progress");
          },
          screenshot: { name: "missing-confirmation-notice", requireText: [labels.approval, labels.stop], rejectText: ["Something went wrong"] },
        });
        await ctx.prove("恢复的审批和输入请求保留明确的操作入口，必须由用户决定", {
          voiceover: "连接恢复后，审批显示允许和拒绝，输入请求显示选项。恢复连接本身不会批准操作或替用户回答。",
          action: async () => {
            await ctx.trustedClick("[data-proof-reconnect]");
            await ctx.waitFor("Boolean(document.querySelector('[data-proof-input] input, [data-proof-input] button'))");
          },
          assert: async () => {
            ctx.assert(await ctx.eval("window.__confirmationProof.receipts.length === 0"), "Replaying a request must not answer it");
            ctx.assert(await ctx.eval(`document.querySelector('[data-proof-approval]').innerText.includes(${JSON.stringify(labels.deny)})`), "Approval must offer a deny action");
          },
          screenshot: { name: "restored-approval-and-input", requireText: [labels.approval, labels.input, labels.once, labels.deny, "已配置模型 A"], rejectText: ["Something went wrong"] },
        });
        await ctx.eval(`([...document.querySelectorAll('[data-proof-approval] button')].find(button => button.innerText.trim() === ${JSON.stringify(labels.deny)})).click()`);
        await ctx.waitFor("window.__confirmationProof.receipts.length === 1");
        ctx.assert(await ctx.eval("window.__confirmationProof.receipts[0].reply === 'reject'"), "The explicit deny action must not become approval");
      } finally {
        await ctx.eval("window.__confirmationProof?.cleanup()").catch(() => {});
      }
    },
  }],
};
