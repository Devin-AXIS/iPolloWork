const DSH_ENGINE_ID = "deepseek-harness";
const DEEPSEEK_CREDENTIAL_REF = "DEEPSEEK_API_KEY";

const runtimeProbe = `(async () => {
  const port = localStorage.getItem("ipollowork.server.port");
  const token = localStorage.getItem("ipollowork.server.token");
  if (!port || !token) return { error: "missing local server connection" };
  const base = "http://127.0.0.1:" + port;
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const workspacesResponse = await fetch(base + "/workspaces", { headers });
  const workspacesPayload = await workspacesResponse.json();
  const workspaces = Array.isArray(workspacesPayload) ? workspacesPayload : workspacesPayload.workspaces ?? [];
  const workspace = workspaces.find((entry) => entry.engineId === ${JSON.stringify(DSH_ENGINE_ID)});
  if (!workspace) return { error: "DeepSeek Harness workspace is unavailable" };
  const rpc = async (method, payload = {}) => {
    const response = await fetch(
      base + "/workspace/" + encodeURIComponent(workspace.id) + "/engine/deepseek-harness/rpc",
      { method: "POST", headers, body: JSON.stringify({ method, payload }) },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? method + " failed: " + response.status);
    return body.value;
  };
  const configured = async () => {
    const state = await rpc("credentials.describe", { refs: [${JSON.stringify(DEEPSEEK_CREDENTIAL_REF)}] });
    return state.credentials?.[${JSON.stringify(DEEPSEEK_CREDENTIAL_REF)}]?.configured === true;
  };
  const before = await configured();
  await rpc("credentials.unset", { ref: ${JSON.stringify(DEEPSEEK_CREDENTIAL_REF)} });
  const afterUnset = await configured();
  const models = await rpc("llm.models", {});
  const afterModelRequest = await configured();
  return {
    workspaceId: workspace.id,
    before,
    afterUnset,
    afterModelRequest,
    hasDeepSeekModels: models.groups?.some((group) =>
      group.id === "deepseek-official" && group.models?.length > 0),
  };
})()`;

export default {
  id: "dsh-provider-credential-self-heal",
  title: "DSH restores shared provider credentials without another login",
  kind: "user-facing",
  steps: [{
    name: "Restore a lost DeepSeek credential through the normal model request",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 30_000,
        label: "window.__ipolloworkControl",
      });
      await ctx.prove("DSH restores the account DeepSeek credential without asking the user to authorize again", {
        voiceover: "DeepSeek 已经在 iPolloWork 账户中配置；即使 DSH 的本地凭证丢失，正常打开模型列表也会自动恢复，不需要再次输入 Key。",
        action: async () => {
          const raw = await ctx.eval(runtimeProbe, { awaitPromise: true });
          ctx.probe = typeof raw === "string" ? JSON.parse(raw) : raw;
          ctx.assert(!ctx.probe?.error, ctx.probe?.error ?? "DSH runtime probe failed.");
          await ctx.navigateHash(`/workspace/${ctx.probe.workspaceId}/session`);
          await ctx.waitFor(
            `Array.from(document.querySelectorAll('button')).some((button) =>
              /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))`,
            { timeoutMs: 30_000, label: "DSH model trigger" },
          );
          await ctx.eval(`(() => {
            const trigger = Array.from(document.querySelectorAll('button'))
              .find((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''));
            trigger?.click();
            return Boolean(trigger);
          })()`);
          await ctx.waitForText("DeepSeek-V4-Flash", { timeoutMs: 30_000 });
        },
        assert: async () => {
          ctx.assert(ctx.probe.before, "The account DeepSeek credential was not configured before the probe.");
          ctx.assert(!ctx.probe.afterUnset, "The probe did not remove the DSH-local credential.");
          ctx.assert(ctx.probe.afterModelRequest, "A normal model request did not restore the credential.");
          ctx.assert(ctx.probe.hasDeepSeekModels, "The restored DeepSeek route exposes no models.");
          const ui = await ctx.eval(`(() => {
            const model = Array.from(document.querySelectorAll('button'))
              .find((button) => button.textContent?.includes('DeepSeek-V4-Flash'));
            return {
              enabled: Boolean(model && !model.disabled && model.getAttribute('aria-disabled') !== 'true'),
              asksToReconnect: document.body.innerText.includes('连接此提供商以浏览和保存模型'),
            };
          })()`);
          ctx.assert(ui.enabled, "The restored DeepSeek model is still disabled in the picker.");
          ctx.assert(!ui.asksToReconnect, "DSH still asks to reconnect the shared DeepSeek provider.");
        },
        screenshot: {
          name: "dsh-deepseek-credential-restored",
          requireText: ["DeepSeek", "DeepSeek-V4-Flash"],
          rejectText: ["连接此提供商以浏览和保存模型"],
        },
      });
    },
  }],
};
