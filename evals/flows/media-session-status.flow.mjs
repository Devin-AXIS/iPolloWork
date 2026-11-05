// Real chat components and mapper, isolated jobs. Never generates paid media.
async function mountProof() {
  const urls = performance.getEntriesByType("resource").map(entry => entry.name);
  const moduleUrl = name => urls.find(url => url.includes(`/deps/${name}.js`));
  const { default: React } = await import(moduleUrl("react"));
  const { default: ReactDOM } = await import(moduleUrl("react-dom_client"));
  const { QueryClient, QueryClientProvider } = await import(moduleUrl("@tanstack_react-query"));
  const chatSource = await (await fetch("/src/components/chat/message-list.tsx")).text();
  // Vite's HMR timestamp is part of context-module identity. Match the exact
  // provider dependency used by the real component, not a second context.
  const providerUrl = chatSource.match(/from "([^"]*message-list-provider\.tsx[^"]*)"/)?.[1];
  if (!providerUrl) throw Error("Chat provider dependency was not found");
  const { MessageListProvider } = await import(providerUrl);
  const { MessageList, VideoJobStatus } = await import(`/src/components/chat/message-list.tsx?proof=${Date.now()}`);
  const artifactSource = await (await fetch("/src/lib/artifacts.ts")).text();
  const targetProviderUrl = artifactSource.match(/from "([^"]*target-provider\.ts[^"]*)"/)?.[1];
  if (!targetProviderUrl) throw Error("Artifact target provider was not found");
  const { OpenTargetProvider } = await import(targetProviderUrl);
  const { withStudioResults } = await import("/src/react-app/domains/session/sync/message-merge.ts");
  const { createCodexLiveState, mapCodexHarnessEvent } = await import("/src/react-app/domains/session/engine/codex-harness-conversation-mapper.ts");
  const host = document.createElement("section");
  host.id = "media-status-proof";
  host.className = "fixed inset-0 z-50 overflow-auto bg-background p-6 text-foreground";
  document.body.append(host);
  const root = ReactDOM.createRoot(host), cache = new QueryClient();
  const state = createCodexLiveState();
  const retry = mapCodexHarnessEvent({ type: "notification", method: "error", params: {
    threadId: "proof", willRetry: true, error: { message: "Reconnecting... waiting for network" },
  } }, state)[0];
  if (retry.type !== "session.status") throw Error("Retry incorrectly became a failure");
  const image = { path: "artifacts/poster.png", size: 120000, updatedAt: 20, generation: { id: "image", kind: "image", model: "Image model", completedAt: 20, width: 941, height: 1672 } };
  const video = { path: "video/proof/renders/clip.mp4", size: 1400000, updatedAt: 40, generation: { id: "video", kind: "video", model: "MiniMax H3", completedAt: 40, width: 544, height: 928, duration: 15.1 } };
  let completed = false;
  const noop = () => {};
  const render = () => {
    const messages = withStudioResults([{ id: "request", role: "user", parts: [{ type: "text", text: "生成图片和视频（隔离验证）" }] },
      { id: "answer", role: "assistant", parts: [{ type: "text", text: "图片已保存：artifacts/poster.png。视频已提交。" }] }],
      completed ? [image, video] : [image], { image: "图片已生成", video: "视频已生成" });
    root.render(React.createElement(QueryClientProvider, { client: cache },
      React.createElement(OpenTargetProvider, { openTargets: [image, video].map(file => ({ id: file.path, kind: "file", value: file.path, name: file.path.split("/").pop(), exists: true, preview: file.generation.kind, confidence: 100, reason: "fixture verified file" })) },
      React.createElement(MessageListProvider, { client: null, workspaceId: "proof", sessionId: "proof", sessionTitle: "素材验证", showThinking: true, developerMode: false, displaySuggestions: false, providerConnectedCount: 1,
        dispatchAction: noop, setPrompt: noop, onRevertToUserMessage: noop, onForkAtMessage: noop, onEditUserMessage: noop },
        React.createElement(MessageList, { messages, status: completed ? "ready" : "retrying", retryStatus: completed ? null : retry.status }),
        React.createElement(VideoJobStatus, { jobs: [{ id: "video", model: "MiniMax H3", status: completed ? "succeeded" : "running", updatedAt: 30 }] }),
        React.createElement("button", { "data-proof-complete": true, className: "mx-auto mt-4 block rounded-lg border px-4 py-2", onClick: () => { completed = true; render(); } }, "模拟视频完成")))));
  };
  window.__mediaStatusProof = { cleanup() { root.unmount(); host.remove(); cache.clear(); delete window.__mediaStatusProof; } };
  render();
}

export default {
  id: "media-session-status", title: "Recoverable retries and independent media delivery", kind: "user-facing", preserveTheme: true,
  steps: [{ name: "Media wait and completion", run: async ctx => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    try {
      await ctx.eval(`(${mountProof.toString()})()`, { awaitPromise: true });
      await ctx.waitFor("Boolean(document.querySelector('#media-status-proof [data-testid=artifact-file-card]'))");
      await ctx.prove("图片卡片保留，视频等待与模型重连分开显示", {
        voiceover: "图片完成后提供独立卡片，视频等待服务商返回；模型连接恢复不再把任务判成失败。",
        action: async () => {},
        assert: async () => {
          ctx.assert(await ctx.eval("document.querySelector('#media-status-proof').innerText.includes('正在生成视频')"), "Video wait must be visible");
          ctx.assert(await ctx.eval("!document.querySelector('#media-status-proof').innerText.includes('处理失败')"), "Retry must not fail the task");
          ctx.assert(await ctx.eval("[...document.querySelectorAll('#media-status-proof [data-testid=artifact-file-card]')].some(card=>card.innerText.includes('PNG'))"), "Image needs a card");
        },
        screenshot: { name: "media-wait", requireText: ["图片已生成", "正在生成视频", "AI 对话连接正在恢复"], rejectText: ["Reconnecting... waiting for network"] },
      });
      await ctx.prove("视频完成后两种产物都有卡片且等待提示消失", {
        voiceover: "视频完成后，图片和视频分别保留交付卡片，等待和重连提示消失。",
        action: async () => { await ctx.trustedClick("[data-proof-complete]"); },
        assert: async () => {
          await ctx.waitFor("document.querySelector('#media-status-proof').innerText.includes('视频已生成')");
          ctx.assert(await ctx.eval("['PNG','MP4'].every(type=>[...document.querySelectorAll('#media-status-proof [data-testid=artifact-file-card]')].some(card=>card.innerText.includes(type)))"), "Both media cards must coexist");
          ctx.assert(await ctx.eval("document.querySelectorAll('#media-status-proof [data-testid=artifact-file-card]').length === 2"), "Exactly one delivery card per generated file");
          ctx.assert(await ctx.eval("!document.querySelector('#media-status-proof [data-video-job-status]')"), "Completed job must not show waiting");
        },
        screenshot: { name: "media-complete", requireText: ["图片已生成", "视频已生成", "PNG", "MP4"] },
      });
    } finally { await ctx.eval("window.__mediaStatusProof?.cleanup()").catch(() => {}); }
  } }],
};
