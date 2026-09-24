import {
  ensureEngineWorkspace,
  selectAndInvokeFreeModel,
  assertFreeModelInvocation,
} from "./opencode-zen-models-unified.flow.mjs";

const engines = [
  { project: "open", engineId: "opencode", label: "OpenCode", name: "免费模型 OpenCode 验证" },
  { project: "codex", engineId: "codex-harness", label: "Codex Harness", name: "免费模型 Codex 验证" },
  { project: "dsh", engineId: "deepseek-harness", label: "DeepSeek Harness", name: "免费模型 DSH 验证" },
].filter((engine) => !process.env.IPOLLOWORK_FRAIMZ_ENGINE || engine.project === process.env.IPOLLOWORK_FRAIMZ_ENGINE);

export default {
  id: "opencode-free-inference",
  title: "Selected free model returns a real reply, not an authentication or quota error",
  kind: "user-facing",
  steps: engines.map((engine) => ({
    name: `${engine.label} returns a real free-model reply`,
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)");
      await ctx.eval("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
      const workspace = await ensureEngineWorkspace(ctx, engine);
      await ctx.navigateHash(`/workspace/${workspace.id}/session`);
      // Route changes replace the composer after its first render.
      await ctx.eval("new Promise((resolve) => setTimeout(resolve, 1200))", { awaitPromise: true });
      await ctx.waitFor(`Array.from(document.querySelectorAll('button')).some((button) =>
        /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
        && button.textContent?.includes('MiMo-V2.5 Free'))`, {
        timeoutMs: 70_000, label: `${engine.label} has MiMo-V2.5 Free selected`,
      });
      let token;
      await ctx.prove(`${engine.label} returns a real free-model reply`, {
        voiceover: `在 ${engine.label} 中向已选择的 MiMo 免费模型发送消息，只有助手真实回复才算通过，报错和限流都算失败。`,
        action: async () => { token = await selectAndInvokeFreeModel(ctx, engine); },
        assert: async () => { await assertFreeModelInvocation(ctx, engine, token); },
        screenshot: { name: `${engine.project}-real-free-reply`, requireText: ["MiMo-V2.5 Free"] },
      });
      const sessionHash = await ctx.eval("location.hash");
      const toolToken = `FREE_${engine.project.toUpperCase()}_TOOL_42`;
      await ctx.prove(`${engine.label} completes a tool round trip in the same conversation`, {
        voiceover: `在同一对话中让免费模型调用终端做只读计算，检查实际工具结果为 42，再检查助手回复。`,
        action: async () => {
          await selectAndInvokeFreeModel(ctx, engine, {
            token: toolToken,
            prompt: `必须调用终端工具执行只读计算 node -p "21*2"，不读写文件、不访问网络。根据工具结果只回复 ${toolToken}。`,
          });
        },
        assert: async () => {
          await assertFreeModelInvocation(ctx, engine, toolToken);
          ctx.assert(await ctx.eval("location.hash") === sessionHash, "Follow-up changed conversation");
          const toolCompleted = await ctx.eval(`(async () => {
            const segments = location.hash.slice(2).split('/');
            const response = await fetch(localStorage.getItem('ipollowork.server.urlOverride')
              + '/workspace/' + segments[1] + '/sessions/' + segments[3] + '/snapshot', {
              headers: { Authorization: 'Bearer ' + localStorage.getItem('ipollowork.server.token') },
            });
            if (!response.ok) return false;
            const body = await response.json();
            return (body.item?.messages ?? []).flatMap((message) => message.parts ?? []).some((part) =>
              part.type === 'tool' && part.state?.status === 'completed'
              && JSON.stringify(part.state.input).includes('21*2')
              && /\\b42\\b/.test(part.state.output ?? ''));
          })()`, { awaitPromise: true });
          ctx.assert(toolCompleted, "No completed calculation tool result was persisted");
        },
        screenshot: { name: `${engine.project}-free-tool-round-trip`, requireText: [toolToken] },
      });
      await ctx.prove(`${engine.label} preserves the free-model conversation after reconnect`, {
        voiceover: "重新加载界面后，对话和刚才的工具调用结果仍然保留。",
        action: async () => {
          await ctx.eval("location.reload()");
          await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
          await ctx.waitFor(`document.querySelector('[data-chat-transcript]')?.textContent?.includes(${JSON.stringify(toolToken)})`, { timeoutMs: 60_000 });
        },
        assert: async () => {
          ctx.assert(await ctx.eval("location.hash") === sessionHash, "Reconnect lost the session route");
          await assertFreeModelInvocation(ctx, engine, toolToken);
        },
        screenshot: { name: `${engine.project}-free-reconnect`, requireText: [toolToken] },
      });
    },
  })),
};
