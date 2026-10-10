import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("conversation-streaming-result");

async function assertImageBadge(ctx, variant, icon, processing = false) {
  const state = await ctx.eval(`(() => {const e=document.querySelector('[data-testid=assistant-image-status]'),i=e?.querySelector('svg');return {variant:e?.dataset.variant,icon:i?.classList.contains(${JSON.stringify(icon)}),animated:i?.classList.contains('animate-spin'),slot:e?.dataset.slot,font:e?getComputedStyle(e).fontSize:null,line:e?getComputedStyle(e).lineHeight:null};})()`);
  ctx.assert(state.slot === 'badge' && state.variant === variant && state.icon && state.animated === processing && state.font === '10px' && state.line === '14px', JSON.stringify(state));
}

export async function mountFixture() {
  window.__streamingAnswerProof?.cleanup?.();
  document.querySelectorAll("#streaming-answer-proof").forEach((node) => node.remove());
  const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
  const moduleUrl = (name) => resources.find((url) => url.includes(name));
  const { default: React } = await import(moduleUrl("/react.js?"));
  const { default: ReactDOM } = await import(moduleUrl("/react-dom_client.js?"));
  const { QueryClient, QueryClientProvider } = await import(moduleUrl("/@tanstack_react-query.js?"));
  const messageListUrl = "/src/components/chat/message-list.tsx";
  const messageListSource = await fetch(messageListUrl).then((response) => response.text());
  const providerUrl = messageListSource.match(/from "([^"]*message-list-provider\.tsx[^\"]*)"/)?.[1];
  if (!providerUrl) throw new Error("Could not resolve the message list provider module");
  const providerSource = await fetch(providerUrl).then((response) => response.text());
  const activityStoreUrl = providerSource.match(/from "([^"]*session-activity-store\.ts[^\"]*)"/)?.[1];
  if (!activityStoreUrl) throw new Error("Could not resolve the session activity store module");
  const { MessageList } = await import(messageListUrl);
  const { MessageListProvider } = await import(providerUrl);
  const { QueuedMessagesPanel } = await import("/src/react-app/domains/session/modals/queued-messages-panel.tsx");
  const { OpenTargetProvider } = await import("/src/lib/target-provider.ts");
  const { createWorkspaceFileOpenTarget } = await import("/src/react-app/domains/session/artifacts/open-target.ts");
  const { createSessionErrorUIMessage } = await import("/src/react-app/domains/session/engine/opencode-message-adapter.ts");
  const { currentLocale, setLocale } = await import("/src/i18n/index.ts");
  const previousLocale = currentLocale();
  setLocale("zh");
  const { useSessionActivityStore } = await import(activityStoreUrl);
  useSessionActivityStore.getState().clearError("proof", "proof");
  const { useSessionScrollStore } = await import("/src/react-app/domains/session/surface/scroll-store.ts");
  const { SessionScrollOverlay } = await import("/src/react-app/domains/session/surface/scroll-overlay.tsx");
  const host = document.createElement("section");
  host.id = "streaming-answer-proof";
  host.className = "fixed inset-0 z-50 overflow-y-auto bg-background px-12 py-16 text-foreground";
  document.body.append(host);
  const root = ReactDOM.createRoot(host);
  const queryClient = new QueryClient();
  const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="960" viewBox="0 0 420 960"><rect width="420" height="960" fill="#193656"/><circle cx="210" cy="320" r="125" fill="#f6bd60"/><path d="M0 780 Q210 480 420 780 V960 H0" fill="#479f92"/></svg>')}`;
  const openTargets = ["design/proof/report.pdf", "design/proof/cover.png", "design/proof/正反馈与负反馈为什么正不一定好完整说明与参考资料内容说明和图示示例与应用场景以及复盘检查清单和附加说明报告.pdf"].map((path) => createWorkspaceFileOpenTarget({ path, size: 122880 }));
  const thumbnailImage = new Image();
  thumbnailImage.src = imageUrl;
  await thumbnailImage.decode();
  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.width = 160; thumbnailCanvas.height = 110;
  const thumbnailContext = thumbnailCanvas.getContext("2d");
  thumbnailContext.drawImage(thumbnailImage, 56, 0, 48, 110);
  const thumbnailBlob = await new Promise(resolve => thumbnailCanvas.toBlob(resolve, "image/webp"));
  const client = {
    resolveArtifacts: async (_workspaceId, targets) => ({ items: targets.map(target => ({ kind: "file", value: target.value, exists: true })) }),
    downloadWorkspaceThumbnail: async () => ({ data: new Uint8Array(await thumbnailBlob.arrayBuffer()), detail: "420 × 960" }),
    baseUrl: "http://127.0.0.1:52999", downloadWorkspaceFile: async (_workspaceId, path) => {
    window.__streamingAnswerProof.downloadedPath = path;
    window.__streamingAnswerProof.downloadRequests=(window.__streamingAnswerProof.downloadRequests||0)+1;
    await window.__streamingAnswerProof.downloadGate;
    return { data: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" };
  } };
  const commentary = {
    id: "proof-commentary", role: "assistant",
    metadata: { ipollowork: { codexPhase: "commentary", created: Date.now() } },
    parts: [{ type: "text", text: "我先检查相关文件。", state: "done" }],
  };
  const initialUser = {
    id: "proof-initial-request", role: "user",
    metadata: { ipollowork: { created: Date.now() - 85_000 } },
    parts: [{ type: "text", text: "请检查文件并给出结论。", state: "done" }],
  };
  const tool = {
    id: "proof-tool", role: "assistant",
    parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "proof-tool-call", input: { command: "rg --files", description: "检查项目文件" }, state: "input-available" }],
  };
  const completedTool = { ...tool, parts: [{ ...tool.parts[0], state: "output-available", output: "ok" }] };
  const answer = (text, state) => ({
    id: "proof-answer", role: "assistant",
    metadata: { ipollowork: { codexPhase: "final_answer", created: Date.now(), ...(state === "done" ? { completed: Date.now() } : {}) } },
    parts: [{ type: "text", text, state }],
  });

  function Fixture() {
    const [messages, setMessages] = React.useState([initialUser, commentary, tool]);
    const [status, setStatus] = React.useState("streaming");
    const [runOutcome, setRunOutcome] = React.useState("running");
    const [activeMessageBaseline, setActiveMessageBaseline] = React.useState(null);
    const [runEndedAt, setRunEndedAt] = React.useState(null);
    const [finalizing, setFinalizing] = React.useState(false);
    const [queued, setQueued] = React.useState([]);
    const [artifactFiles, setArtifactFiles] = React.useState([]);
    const [stoppedImageMessageIds, setStoppedImageMessageIds] = React.useState(new Set());
    const [stopAcknowledged, setStopAcknowledged] = React.useState(false);
    const [retryStatus, setRetryStatus] = React.useState(null);
    React.useEffect(() => {
      window.__streamingAnswerProof.pauseProcess = () => setStatus("ready");
      window.__streamingAnswerProof.resumeProcess = () => setStatus("streaming");
      window.__streamingAnswerProof.advance = () => {
        setMessages([initialUser, commentary, completedTool, answer("检查完成，正在整理", "streaming")]);
        setQueued(["完成后再检查测试结果"]);
      };
      window.__streamingAnswerProof.append = () => {
        setMessages([initialUser, commentary, completedTool, answer("检查完成，正在整理最终建议。", "streaming")]);
        setFinalizing(true);
      };
      window.__streamingAnswerProof.finish = () => {
        setFinalizing(false);
        setMessages([initialUser, commentary, completedTool, answer("检查完成，正在整理最终建议。", "done")]);
        setStatus("ready");
        setRunOutcome("completed");
      };
      window.__streamingAnswerProof.showCompletedWhilePostProcessing = () => {
        setFinalizing(false);
        setMessages([
          { id: "proof-export-request", role: "user", parts: [{ type: "text", text: "生成视频并发布到视频号" }] },
          commentary,
          completedTool,
          answer("视频源文件已生成，iPolloWork 应用正在导出 MP4。", "done"),
        ]);
        setStatus("submitted");
        setRunOutcome("completed");
      };
      window.__streamingAnswerProof.showGroupedCommands = () => {
        useSessionActivityStore.getState().clearError("proof", "proof");
        setStopAcknowledged(false);
        setFinalizing(false);
        setStatus("ready");
        setRunOutcome("completed");
        setMessages([
          { id: "proof-group-request", role: "user", metadata: { ipollowork: { created: Date.now() - 15_000 } }, parts: [{ type: "text", text: "检查并修改文件" }] },
          { id: "proof-group-inspect", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "read", toolCallId: "proof-read", state: "output-available", input: { filePath: "entry.html" }, output: "content" }] },
          { id: "proof-group-commands", role: "assistant", parts: [
            { type: "dynamic-tool", toolName: "bash", toolCallId: "proof-command-1", state: "output-available", input: { command: "sed -n '1,40p' entry.html", description: "Inspect entry" }, output: "ok" },
            { type: "dynamic-tool", toolName: "bash", toolCallId: "proof-command-2", state: "output-available", input: { command: "rg 'theme' entry.html", description: "Check theme" }, output: "ok" },
          ] },
          { id: "proof-group-answer", role: "assistant", metadata: { ipollowork: { codexPhase: "final_answer", completed: Date.now() } }, parts: [{ type: "text", text: "文件已检查。\n\n已更新：\n\n- [palette.json](design/proof/palette.json)\n- [design-tokens.css](design/proof/design-tokens.css)\n\n风格调整完成。", state: "done" }] },
        ]);
      };
      window.__streamingAnswerProof.showOpenCodePhase = (phase) => {
        useSessionActivityStore.getState().clearError("proof", "proof");
        setActiveMessageBaseline(null);
        setStopAcknowledged(false);
        setFinalizing(false);
        setRunOutcome("running");
        setStatus(phase === "waiting" ? "submitted" : "streaming");
        const parts = phase === "waiting" ? []
          : phase === "reasoning" ? [{ type: "reasoning", text: "正在检查上下文", state: "streaming" }]
          : phase === "tool" ? [{ type: "dynamic-tool", toolName: "bash", toolCallId: "opencode-proof-command", state: "input-available", input: { command: "rg --files", description: "检查项目文件" } }]
          : [{ type: "text", text: "已找到相关文件。", state: "streaming" }];
        setMessages([
          { id: "opencode-proof-user", role: "user", parts: [{ type: "text", text: "检查项目" }] },
          { id: "opencode-proof-assistant", role: "assistant", parts },
        ]);
      };
      window.__streamingAnswerProof.appendOpenCodeStep = () => {
        setMessages((messages) => [...messages,
          { id: "opencode-proof-tool", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "ordered-command", state: "output-available", input: { command: "pwd", description: "确认工作目录" }, output: "workspace" }] },
          { id: "opencode-proof-final", role: "assistant", parts: [{ type: "text", text: "目录确认完成。", state: "streaming" }] },
        ]);
      };
      window.__streamingAnswerProof.finishOpenCode = () => {
        setStatus("ready");
        setRunOutcome("completed");
      };
      window.__streamingAnswerProof.showOpenCodeContinuation = () => {
        setActiveMessageBaseline(2);
        setRunOutcome("running");
        setStatus("streaming");
        setMessages([
          { id: "opencode-continuation-user", role: "user", parts: [{ type: "text", text: "请检查项目" }] },
          { id: "opencode-previous-answer", role: "assistant", parts: [{ type: "text", text: "目录已经找到。", state: "done" }] },
        ]);
      };
      window.__streamingAnswerProof.showFile = () => {
        setRunOutcome("running");
        setQueued([]);
        setArtifactFiles(["design/proof/report.pdf"]);
        setMessages([
          { id: "proof-file-request", role: "user", parts: [{ type: "text", text: "请生成报告" }] },
          { id: "proof-file-answer", role: "assistant", metadata: { ipollowork: { codexPhase: "final_answer" } },
            parts: [{ type: "text", text: "报告已生成，正在核对文件。", state: "streaming" }] },
        ]);
        setStatus("streaming");
      };
      window.__streamingAnswerProof.finishFile = () => {
        setRunOutcome("completed");
        setMessages([
          { id: "proof-file-request", role: "user", parts: [{ type: "text", text: "请生成报告" }] },
          { id: "proof-file-answer", role: "assistant", metadata: { ipollowork: { codexPhase: "final_answer" } },
            parts: [{ type: "text", text: "报告已生成，点击下方文件查看。", state: "done" }] },
        ]);
        setStatus("ready");
      };
      window.__streamingAnswerProof.showReferenceCard = () => {
        setArtifactFiles(["design/proof/正反馈与负反馈为什么正不一定好完整说明与参考资料内容说明和图示示例与应用场景以及复盘检查清单和附加说明报告.pdf"]);
        setMessages([
          { id: "reference-file-user", role: "user", parts: [{ type: "text", text: "请生成报告" }] },
          { id: "reference-file-answer", role: "assistant", parts: [{ type: "text", text: "报告已保存。", state: "done" }] },
        ]);
        setStatus("ready"); setRunOutcome("completed"); setFinalizing(false);
      };
      window.__streamingAnswerProof.showImage = () => {
        setRunOutcome("running");
        setRunEndedAt(null);
        useSessionActivityStore.getState().clearError("proof", "proof");
        setStopAcknowledged(false);
        setRetryStatus(null);
        setStoppedImageMessageIds(new Set());
        setArtifactFiles([]);
        setMessages([
          { id: "proof-image-request", role: "user", metadata: { ipollowork: { created: Date.now() - 42_000 } }, parts: [
            { type: "text", text: "请参考这张图片生成封面" },
            { type: "file", url: imageUrl, mediaType: "image/svg+xml", filename: "reference.svg" },
          ] },
          { id: "proof-image-answer", role: "assistant", metadata: { ipollowork: { codexPhase: "final_answer" } },
            parts: [
              { type: "text", text: "封面预览正在生成。", state: "streaming" },
              { type: "file", url: imageUrl, mediaType: "image/svg+xml", filename: "cover.png" },
            ] },
        ]);
        setStatus("streaming");
      };
      window.__streamingAnswerProof.saveImage = () => {
        setArtifactFiles(["design/proof/cover.png"]);
      };
      window.__streamingAnswerProof.finishImage = () => {
        setRunOutcome("completed");
        setRunEndedAt(Date.now());
        setArtifactFiles(["design/proof/cover.png"]);
        setMessages([
          { id: "proof-image-request", role: "user", metadata: { ipollowork: { created: Date.now() - 42_000 } }, parts: [
            { type: "text", text: "请参考这张图片生成封面" },
            { type: "file", url: imageUrl, mediaType: "image/svg+xml", filename: "reference.svg" },
          ] },
          { id: "proof-image-answer", role: "assistant", metadata: { ipollowork: { codexPhase: "final_answer" } },
            parts: [
              { type: "text", text: "封面已生成。", state: "done" },
              { type: "file", url: imageUrl, mediaType: "image/svg+xml", filename: "cover.png" },
            ] },
        ]);
        setStatus("ready");
      };
      window.__streamingAnswerProof.stopImage = () => {
        setRunOutcome("stopped");
        setRunEndedAt(Date.now());
        setStoppedImageMessageIds(new Set(["proof-image-answer"]));
        setStopAcknowledged(true);
        setStatus("ready");
      };
      window.__streamingAnswerProof.showStoppedText = () => {
        window.__streamingAnswerProof.showImage();
        window.__streamingAnswerProof.stopImage();
        setMessages(previous => [...previous,
          { id: "proof-text-stop-request", role: "user", parts: [{ type: "text", text: "请继续写报告" }] },
          { id: "proof-text-stop-answer", role: "assistant", parts: [{ type: "text", text: "已完成部分报告。", state: "done" }] },
        ]);
      };
      window.__streamingAnswerProof.failImage = () => {
        setRunOutcome("failed");
        setRunEndedAt(Date.now());
        useSessionActivityStore.getState().setError("proof", "proof", "图片生成失败");
        setStatus("ready");
      };
      window.__streamingAnswerProof.showUnmatchedImage = () => {
        setRunOutcome("completed");
        useSessionActivityStore.getState().clearError("proof", "proof");
        setStopAcknowledged(false);
        setStoppedImageMessageIds(new Set());
        setArtifactFiles(["design/proof/cover.png"]);
        setMessages([
          { id: "proof-image-request", role: "user", parts: [{ type: "text", text: "请生成封面" }] },
          { id: "proof-image-answer", role: "assistant", metadata: { ipollowork: { codexPhase: "final_answer" } },
            parts: [
              { type: "text", text: "封面预览已就绪。", state: "done" },
              { type: "file", url: imageUrl, mediaType: "image/svg+xml", filename: "preview.svg" },
            ] },
        ]);
        setStatus("ready");
      };
      window.__streamingAnswerProof.browseOlder = () => {
        useSessionScrollStore.getState().setManualScroll("proof", 100, null);
      };
      window.__streamingAnswerProof.showRetry = () => {
        setRunOutcome("running");
        useSessionActivityStore.getState().clearError("proof", "proof");
        setStopAcknowledged(false);
        setArtifactFiles([]);
        setMessages([commentary, tool]);
        setStatus("retrying");
        setRetryStatus({ type: "retry", attempt: 2, next: Date.now() + 10000, message: "HTTP 503 upstream connection reset" });
      };
      window.__streamingAnswerProof.showToolFailure = () => {
        setRunOutcome("running");
        setRetryStatus(null);
        setStatus("streaming");
        setMessages([commentary, { ...tool, parts: [{ ...tool.parts[0], state: "output-error", errorText: "ENOENT /secret/path" }] }]);
      };
      window.__streamingAnswerProof.showTerminalError = () => {
        setRunOutcome("failed");
        setRetryStatus(null);
        setStatus("ready");
        useSessionActivityStore.getState().setError("proof", "proof", "HTTP 429 rate limit: raw provider response");
      };
      window.__streamingAnswerProof.showSavedImageFailure = () => {
        window.__streamingAnswerProof.showImage();
        setRunOutcome("failed");
        setArtifactFiles(["design/proof/cover.png"]);
        setStatus("ready");
        useSessionActivityStore.getState().setError("proof", "proof", "HTTP 503 upstream connection reset");
      };
      window.__streamingAnswerProof.showHistoricalInterruption = () => {
        setRunOutcome("stopped");
        useSessionActivityStore.getState().clearError("proof", "proof");
        setStopAcknowledged(false);
        setArtifactFiles([]);
        setRetryStatus(null);
        setMessages([
          { id: "proof-interrupted-request", role: "user", parts: [{ type: "text", text: "请继续处理" }] },
          { id: "proof-interrupted-answer", role: "assistant", parts: [{ type: "text", text: "已完成部分内容。", state: "done" }] },
          createSessionErrorUIMessage("proof-interrupted-answer", "The run was interrupted before it finished."),
        ]);
        setStatus("ready");
      };
      window.__streamingAnswerProof.showUnsupportedModel = () => {
        setRunOutcome("failed");
        useSessionActivityStore.getState().clearError("proof", "proof");
        setStopAcknowledged(false);
        setArtifactFiles([]);
        setRetryStatus(null);
        setMessages([{ id: "proof-model-request", role: "user", parts: [{ type: "text", text: "你好" }] }]);
        setStatus("ready");
        useSessionActivityStore.getState().setError("proof", "proof", "The 'gpt-5.6-terra-fast' model is not supported when using Codex with a ChatGPT account.");
      };
    }, []);
    return React.createElement(QueryClientProvider, { client: queryClient },
      React.createElement(OpenTargetProvider, { openTargets,
        onOpenTarget: (target) => { window.__streamingAnswerProof.openedPath = target.value; } },
      React.createElement(MessageListProvider, {
        client, workspaceId: "proof", sessionId: "proof", sessionTitle: "Streaming proof",
        showThinking: true, developerMode: false, displaySuggestions: false, providerConnectedCount: 1,
        onRevertToUserMessage() {}, onForkAtMessage() {}, onEditUserMessage() {},
        dispatchAction() {}, setPrompt() {},
      }, React.createElement("main", { className: "mx-auto max-w-[850px]" },
        React.createElement("h1", { className: "mb-8 text-xl font-semibold" }, "对话流式输出"),
        React.createElement(MessageList, { messages, status, runOutcome, activeMessageBaseline, runEndedAt, finalizing, retryStatus, artifactFiles, stoppedImageMessageIds, stopAcknowledged }),
        queued.length ? React.createElement("div", { className: "mt-8" },
          React.createElement(QueuedMessagesPanel, { messages: queued, onRemove: () => setQueued([]) })) : null),
        React.createElement(SessionScrollOverlay, { sessionId: "proof", isStreaming: status === "streaming",
          onJumpToLatest: () => useSessionScrollStore.getState().setStickyBottom("proof", null),
          onJumpToStartOfMessage() {} }))));
  }

  window.__streamingAnswerProof = {
    cleanup() { root.unmount(); host.remove(); setLocale(previousLocale); delete window.__streamingAnswerProof; },
  };
  root.render(React.createElement(Fixture));
}

export default {
  id: "conversation-streaming-result",
  title: "Final answer streams in place below collapsible progress",
  ...(process.env.IPOLLOWORK_EVAL_APP_ORIGIN ? { cdpTarget: { urlIncludes: process.env.IPOLLOWORK_EVAL_APP_ORIGIN } } : {}),
  kind: "user-facing",
  steps: [
    {
      name: "Live process preserves manual disclosure across transient idle",
      run: (ctx) => ctx.prove("Progress shows chronological steps while running and a manual expansion survives a transient idle status", {
        voiceover: vo[0],
        action: () => ctx.eval(`(${mountFixture.toString()})()`, { awaitPromise: true }),
        assert: async () => {
          await ctx.waitFor("Boolean(document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column]'))");
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            const process = host.querySelector('[data-testid=assistant-process-column]');
            return { open: process.querySelector('button')?.getAttribute('aria-expanded'),
              commentary: process.textContent.includes('我先检查相关文件'),
              commentaryBeforeCommand: process.textContent.indexOf('我先检查相关文件') < process.textContent.indexOf('运行命令'),
              liveAction: process.querySelector('[data-tool-action=command] summary')?.textContent,
              commandDetailsClosed: !process.querySelector('[data-tool-action=command]')?.open,
              duplicateProgress: Boolean(host.querySelector('[data-testid=assistant-streaming-progress]')),
              pending: Boolean(host.querySelector('[data-testid=assistant-result-pending]')),
              currentState: host.querySelector('[data-testid=assistant-current-state]')?.textContent,
              activityKind: host.querySelector('[data-testid=assistant-live-activity]')?.getAttribute('data-activity-kind'),
              thinkingDots: host.querySelectorAll('[data-testid=assistant-result-pending] .chat-thinking-dots span').length,
              result: Boolean(host.querySelector('[data-assistant-result]')) };
          })()`);
          ctx.assert(state.open === "true" && state.commentary && state.commentaryBeforeCommand && !state.duplicateProgress && !state.result
            && state.liveAction?.includes("运行命令") && state.liveAction?.includes("检查项目文件") && state.commandDetailsClosed
            && !state.pending && state.currentState?.includes("检查项目文件")
            && state.thinkingDots === 0, JSON.stringify(state));
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button').click()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.getAttribute('aria-expanded') === 'false'");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button').click()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.getAttribute('aria-expanded') === 'true'");
          ctx.assert(await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column]').textContent.includes('我先检查相关文件')"), "Expanded process lost the chronological commentary.");
          await ctx.eval("window.__streamingAnswerProof.pauseProcess()");
          await ctx.eval("new Promise(resolve => setTimeout(resolve, 300))", { awaitPromise: true });
          const paused = await ctx.eval(`(() => {
            const process = document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column]');
            return { open: process.querySelector('button')?.getAttribute('aria-expanded'), label: process.querySelector('button')?.textContent };
          })()`);
          ctx.assert(paused.open === "true", JSON.stringify(paused));
          await ctx.eval("window.__streamingAnswerProof.resumeProcess()");
          const beforeTick = await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.textContent");
          await ctx.eval("new Promise(resolve => setTimeout(resolve, 1_200))", { awaitPromise: true });
          const afterTick = await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.textContent");
          ctx.assert(beforeTick !== afterTick && afterTick.includes("已用时"), "The live elapsed time did not advance.");
        },
        screenshot: { name: "streaming-process", requireText: ["对话流式输出", "我先检查相关文件", "检查项目文件"] },
      }),
    },
    {
      name: "Final answer grows in one result element",
      run: (ctx) => ctx.prove("The partial final answer grows in place while progress accurately switches to finishing", {
        voiceover: vo[1],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.advance()");
          await ctx.waitFor("Boolean(document.querySelector('#streaming-answer-proof [data-assistant-result]'))");
          await ctx.eval("Boolean(window.__streamingAnswerProof.resultNode = document.querySelector('#streaming-answer-proof [data-assistant-result]'))");
          await ctx.eval("window.__streamingAnswerProof.append()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-assistant-result]')?.textContent.includes('最终建议')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            const process = host.querySelector('[data-testid=assistant-process-column]');
            const result = host.querySelector('[data-assistant-result]');
            return { sameNode: result === window.__streamingAnswerProof.resultNode,
              pending: Boolean(host.querySelector('[data-testid=assistant-result-pending]')),
              belowProcess: process.getBoundingClientRect().bottom <= result.getBoundingClientRect().top,
              text: result.textContent, processText: process.textContent };
          })()`);
          ctx.assert(state.sameNode && !state.pending && state.belowProcess && state.text.includes("最终建议")
            && !state.processText.includes("最终建议") && state.processText.includes("正在回复"), JSON.stringify(state));
        },
        screenshot: { name: "streaming-result", requireText: ["正在回复", "最终建议"] },
      }),
    },
    {
      name: "Completion folds process details without remounting the answer",
      run: (ctx) => ctx.prove("Completion folds progress, freezes elapsed time, and keeps the final answer and queued follow-up", {
        voiceover: vo[2],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.finish()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.textContent.includes('用时')");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.getAttribute('aria-expanded') === 'false'");
          const frozen = await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.textContent");
          ctx.assert(frozen.includes("已处理 1 个命令"), `Command count missing from elapsed heading: ${frozen}`);
          await ctx.eval("new Promise(resolve => setTimeout(resolve, 1_200))", { awaitPromise: true });
          ctx.assert(frozen === await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.textContent"), "Completed elapsed time continued ticking.");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button').click()");
          ctx.assert(await ctx.eval("!document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column]').textContent.includes('检查完成，正在整理最终建议')"), "Expanded process repeated the final answer.");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button').click()");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            const result = host.querySelector('[data-assistant-result]');
            const action = host.querySelector('[data-testid=assistant-message-actions] button');
            const answerText = result?.querySelector('[data-chat-readable-text]');
            return { sameNode: result === window.__streamingAnswerProof.resultNode,
              answer: result?.textContent.includes('最终建议'),
              queue: host.textContent.includes('完成后再检查测试结果'),
              actionSize: action?.getBoundingClientRect().width,
              iconSize: action?.querySelector('svg')?.getBoundingClientRect().width,
              answerBackground: answerText && getComputedStyle(answerText).backgroundColor,
              answerBorder: answerText && getComputedStyle(answerText).borderTopWidth,
              answerSize: answerText && getComputedStyle(answerText).fontSize,
              processBorder: getComputedStyle(host.querySelector('.chat-process-heading')).borderBottomWidth };
          })()`);
          ctx.assert(state.sameNode && state.answer && state.queue && state.actionSize === 28
            && state.iconSize === 14 && state.answerBackground === 'rgba(0, 0, 0, 0)'
            && state.answerBorder === '0px' && state.answerSize === '13px' && state.processBorder === '0px', JSON.stringify(state));
        },
        screenshot: { name: "completed-result", requireText: ["用时", "已处理 1 个命令", "最终建议", "完成后再检查测试结果"] },
      }),
    },
    {
      name: "A generated document becomes an actionable file card after completion",
      run: (ctx) => ctx.prove("The file card waits for completion and opens the saved document", {
        voiceover: vo[3],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showFile()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-assistant-result]')?.textContent.includes('正在核对文件')");
          ctx.assert(await ctx.eval("!document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]')"), "The file card appeared before the run completed.");
          await ctx.eval("window.__streamingAnswerProof.finishFile()");
          await ctx.waitFor("Boolean(document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]'))");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]').click()");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            const card = host.querySelector('[data-testid=artifact-file-card]');
            return { tag: card?.tagName, title: card?.querySelector('[data-testid=artifact-file-title]')?.textContent,
              opened: window.__streamingAnswerProof.openedPath,
              answer: host.querySelector('[data-assistant-result]')?.textContent };
          })()`);
          ctx.assert(state.tag === "BUTTON" && state.title && state.opened === "design/proof/report.pdf"
            && state.answer.includes("报告已生成"), JSON.stringify(state));
        },
        screenshot: { name: "completed-file-card", requireText: ["报告已生成", "PDF"] },
      }),
    },
    {
      name: "Streaming image is clearly marked as a preview",
      run: (ctx) => ctx.prove("An inline image remains visibly marked as incomplete while the assistant streams", {
        voiceover: vo[4],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof img[alt=\"cover.png\"]')?.naturalHeight === 960");
          ctx.assert(await ctx.eval("!document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]')"), "Image output card appeared before completion.");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-assistant-result]').scrollIntoView({ block: 'start' })");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            return { preview: host.querySelector('[data-testid=assistant-image-status]')?.textContent,
              userHeight: host.querySelector('img[alt="reference.svg"]')?.parentElement?.style.maxHeight };
          })()`);
          await assertImageBadge(ctx, "info", "lucide-loader-circle", true);
          ctx.assert(state.preview?.includes("仍在生成") && state.userHeight === "160px", JSON.stringify(state));
        },
        screenshot: { name: "streaming-image-preview", requireText: ["仍在生成"] },
      }),
    },
    {
      name: "Saved image remains distinct from turn completion",
      run: (ctx) => ctx.prove("A saved image is actionable while the assistant still finishes the response", {
        voiceover: vo[5],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.saveImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('正在整理结果')");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-assistant-result]').scrollIntoView({ block: 'start' })");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            return { status: host.querySelector('[data-testid=assistant-image-status]')?.textContent,
              open: [...host.querySelectorAll('button')].some((button) => button.textContent === '打开图片'),
              download: [...host.querySelectorAll('button')].some((button) => button.textContent === '下载图片') };
          })()`);
          await assertImageBadge(ctx, "info", "lucide-loader-circle", true);
          ctx.assert(state.status?.includes("图片已保存") && state.open && state.download, JSON.stringify(state));
        },
        screenshot: { name: "saved-image-still-streaming", requireText: ["图片已保存", "正在整理结果", "打开图片"] },
      }),
    },
    {
      name: "Browsing older messages reveals new content entry",
      run: (ctx) => ctx.prove("Streaming while away from the bottom shows a labeled way back to new content", {
        voiceover: vo[6],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.browseOlder()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=jump-to-latest]')?.textContent.includes('有新内容')");
        },
        assert: async () => {
          const label = await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=jump-to-latest]')?.textContent");
          ctx.assert(label?.includes("有新内容"), String(label));
        },
        screenshot: { name: "new-content-entry", requireText: ["有新内容", "正在整理结果"] },
      }),
    },
    {
      name: "Completed image has one saved-file action area",
      run: (ctx) => ctx.prove("The completed image exposes saved-file actions without a duplicate card", {
        voiceover: vo[7],
        action: async () => {
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=jump-to-latest]')?.click()");
          await ctx.eval("window.__streamingAnswerProof.finishImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('图片已生成')");
          await ctx.eval("[...document.querySelectorAll('#streaming-answer-proof button')].find((button) => button.textContent === '打开图片')?.click()");
          await ctx.eval("[...document.querySelectorAll('#streaming-answer-proof button')].find((button) => button.textContent === '下载图片')?.click()");
          await ctx.waitFor("window.__streamingAnswerProof.downloadedPath === 'design/proof/cover.png'");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-assistant-result]').scrollIntoView({ block: 'start' })");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            const user = host.querySelector('img[alt="reference.svg"]');
            const assistant = host.querySelector('img[alt="cover.png"]');
            return { userDecoded: user?.complete && user.naturalHeight === 960,
              assistantDecoded: assistant?.complete && assistant.naturalHeight === 960,
              opened: window.__streamingAnswerProof.openedPath,
              downloaded: window.__streamingAnswerProof.downloadedPath,
              card: Boolean(host.querySelector('[data-testid=artifact-file-card]')) };
          })()`);
          ctx.assert(state.userDecoded && state.assistantDecoded && state.opened === "design/proof/cover.png"
            && state.downloaded === "design/proof/cover.png"
            && !state.card, JSON.stringify(state));
        },
        screenshot: { name: "completed-image-actions", requireText: ["封面已生成", "图片已生成", "打开图片", "下载图片"] },
      }),
    },
    {
      name: "Tall image preview expands",
      run: (ctx) => ctx.prove("A tall image expands to its full height", {
        voiceover: vo[8],
        action: async () => {
          await ctx.eval(`(() => {
            const image = document.querySelector('#streaming-answer-proof img[alt="cover.png"]');
            image?.closest('button')?.click();
            image?.scrollIntoView({ block: 'start' });
            return true;
          })()`);
          await ctx.waitFor("document.querySelector('#streaming-answer-proof img[alt=\"cover.png\"]')?.closest('button')?.getAttribute('aria-expanded') === 'true'");
        },
        assert: async () => {
          const expanded = await ctx.eval("document.querySelector('#streaming-answer-proof img[alt=\"cover.png\"]')?.closest('button')?.getAttribute('aria-expanded') === 'true'");
          ctx.assert(expanded, "The full image did not expand.");
        },
        screenshot: { name: "expanded-image-preview", requireText: ["封面已生成"] },
      }),
    },
    {
      name: "Tall image preview collapses",
      run: (ctx) => ctx.prove("The full image returns to a compact preview", {
        voiceover: vo[9],
        action: async () => {
          await ctx.eval(`(() => {
            const image = document.querySelector('#streaming-answer-proof img[alt="cover.png"]');
            image?.closest('button')?.click();
            document.querySelector('#streaming-answer-proof [data-assistant-result]')?.scrollIntoView({ block: 'start' });
            return true;
          })()`);
          await ctx.waitFor("document.querySelector('#streaming-answer-proof img[alt=\"cover.png\"]')?.closest('button')?.getAttribute('aria-expanded') === 'false'");
        },
        assert: async () => {
          ctx.assert(await ctx.eval("document.querySelector('#streaming-answer-proof img[alt=\"cover.png\"]')?.closest('button')?.getAttribute('aria-expanded') === 'false'"), "The compact preview was not restored.");
        },
        screenshot: { name: "compact-image-preview", requireText: ["封面已生成"] },
      }),
    },
    {
      name: "Stopped image run keeps an incomplete label",
      run: (ctx) => ctx.prove("Stopping the run keeps the preview and marks it incomplete", {
        voiceover: vo[10],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('仍在生成')");
          await ctx.eval("window.__streamingAnswerProof.stopImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('已停止')");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-assistant-result]').scrollIntoView({ block: 'start' })");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            return { status: host.querySelector('[data-testid=assistant-image-status]')?.textContent,
              noticeCount: host.querySelectorAll('[data-testid=run-issue-notice]').length,
              duration: host.querySelector('[data-testid=assistant-process-column]')?.textContent,
              image: Boolean(host.querySelector('img[alt="cover.png"]')) };
          })()`);
          await assertImageBadge(ctx, "warning", "lucide-circle-pause");
          ctx.assert(state.status?.includes("图片可能未完成") && state.noticeCount === 0
            && state.duration?.includes("已停止 · 用时") && state.image, JSON.stringify(state));
        },
        screenshot: { name: "stopped-image", requireText: ["已停止", "图片可能未完成"] },
      }),
    },
    {
      name: "Failed image run keeps an incomplete label",
      run: (ctx) => ctx.prove("A failed run keeps the preview and states that it may be incomplete", {
        voiceover: vo[11],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('仍在生成')");
          await ctx.eval("window.__streamingAnswerProof.failImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('任务未完成')");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-assistant-result]').scrollIntoView({ block: 'start' })");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            return { status: host.querySelector('[data-testid=assistant-image-status]')?.textContent,
              duration: host.querySelector('[data-testid=assistant-process-column]')?.textContent,
              image: Boolean(host.querySelector('img[alt="cover.png"]')) };
          })()`);
          await assertImageBadge(ctx, "destructive", "lucide-circle-alert");
          ctx.assert(state.status?.includes("图片可能未完成") && state.duration?.includes("未完成 · 用时")
            && state.image, JSON.stringify(state));
        },
        screenshot: { name: "failed-image", requireText: ["任务未完成", "图片可能未完成"] },
      }),
    },
    {
      name: "Unmatched preview retains the saved file card",
      run: (ctx) => ctx.prove("When the inline preview cannot be identified as the saved file, the file card remains available", {
        voiceover: vo[12],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showUnmatchedImage()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('预览已就绪')");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-assistant-result]').scrollIntoView({ block: 'start' })");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            return { status: host.querySelector('[data-testid=assistant-image-status]')?.textContent,
              preview: Boolean(host.querySelector('img[alt="preview.svg"]')),
              card: host.querySelector('[data-testid=artifact-file-card]')?.textContent };
          })()`);
          await assertImageBadge(ctx, "info", "lucide-info");
          ctx.assert(state.status?.includes("预览已就绪") && state.preview && state.card?.includes("cover.png"), JSON.stringify(state));
        },
        screenshot: { name: "unmatched-image-file", requireText: ["预览已就绪", "cover.png"] },
      }),
    },
    {
      name: "Recoverable tool failure keeps the result pending",
      run: (ctx) => ctx.prove("A failed step leaves a quiet pending result without exposing its raw tool error", {
        voiceover: vo[13],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showToolFailure()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-current-state]')?.textContent.includes('正在思考')");
        },
        assert: async () => {
          const text = await ctx.eval("document.querySelector('#streaming-answer-proof')?.textContent");
          ctx.assert(text.includes("正在思考") && !text.includes("有一步未成功")
            && !text.includes("ENOENT /secret/path"), text);
        },
        screenshot: { name: "recoverable-tool-failure", requireText: ["正在思考"] },
      }),
    },
    {
      name: "Automatic retry keeps technical detail collapsed",
      run: (ctx) => ctx.prove("Retry status shows timing while the raw transport error is collapsed", {
        voiceover: vo[14],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showRetry()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof')?.textContent.includes('连接中断，正在自动重试')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => { const host = document.querySelector('#streaming-answer-proof');
            const details = [...host.querySelectorAll('details')].find((node) => node.textContent.includes('HTTP 503'));
            return { retry: host.textContent.includes('第 2 次尝试'), collapsed: details && !details.open }; })()`);
          ctx.assert(state.retry && state.collapsed, JSON.stringify(state));
        },
        screenshot: { name: "automatic-retry", requireText: ["正在自动重试", "第 2 次尝试"] },
      }),
    },
    {
      name: "Terminal error appears in response text",
      run: (ctx) => ctx.prove("Final failure appears as ordinary response text without a card", {
        voiceover: vo[15],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showTerminalError()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-assistant-run-error]')?.textContent.includes('HTTP 429 rate limit')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => { const host = document.querySelector('#streaming-answer-proof');
            return { text: host.querySelector('[data-assistant-run-error]')?.textContent,
              cards: host.querySelectorAll('[data-testid=run-issue-notice]').length }; })()`);
          ctx.assert(state.text?.includes('本次任务未完成') && state.text.includes('HTTP 429 rate limit') && state.cards === 0, JSON.stringify(state));
        },
        screenshot: { name: "terminal-error-details", requireText: ["本次任务未完成", "HTTP 429 rate limit"] },
      }),
    },
    {
      name: "Saved image remains ready if the run fails later",
      run: (ctx) => ctx.prove("An already saved image remains usable even when the overall run ends in failure", {
        voiceover: vo[16],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showSavedImageFailure()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-image-status]')?.textContent.includes('图片已生成')");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-assistant-run-error]')?.scrollIntoView({ block: 'end' })");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => { const host = document.querySelector('#streaming-answer-proof');
            return { saved: host.querySelector('[data-testid=assistant-image-status]')?.textContent,
              open: host.textContent.includes('打开图片'), run: host.textContent.includes('本次任务未完成'),
              errorInReply: Boolean(host.querySelector('[data-assistant-result] [data-assistant-run-error]')),
              cards: host.querySelectorAll('[data-testid=run-issue-notice]').length }; })()`);
          await assertImageBadge(ctx, "success", "lucide-circle-check");
          ctx.assert(state.saved?.includes('图片已生成') && state.open && state.run && state.errorInReply && state.cards === 0, JSON.stringify(state));
        },
        screenshot: { name: "saved-image-after-failure", requireText: ["图片已生成", "打开图片", "本次任务未完成"] },
      }),
    },
    {
      name: "Historical interruption reopens as an interruption",
      run: (ctx) => ctx.prove("A replayed interrupted turn keeps partial text and shows the reason inline", {
        voiceover: vo[17],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showHistoricalInterruption()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-assistant-run-error]')?.textContent.includes('interrupted')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => { const host = document.querySelector('#streaming-answer-proof');
            const result = host.querySelector('[data-assistant-result]');
            return { partial: result?.textContent.includes('已完成部分内容'), rawInResult: result?.textContent.includes('interrupted'),
              interrupted: host.querySelector('[data-assistant-run-error]')?.textContent.includes('interrupted'),
              cards: host.querySelectorAll('[data-testid=run-issue-notice]').length }; })()`);
          ctx.assert(state.partial && state.interrupted && state.cards === 0, JSON.stringify(state));
        },
        screenshot: { name: "historical-interruption", requireText: ["已完成部分内容", "本次任务未完成"] },
      }),
    },
    {
      name: "Unsupported model explains the next action",
      run: (ctx) => ctx.prove("An unsupported model error appears as ordinary conversation text", {
        voiceover: vo[18],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showUnsupportedModel()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-assistant-run-error]')?.textContent.includes('not supported')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => { const host = document.querySelector('#streaming-answer-proof');
            return { text: host.querySelector('[data-assistant-run-error]')?.textContent,
              cards: host.querySelectorAll('[data-testid=run-issue-notice]').length }; })()`);
          ctx.assert(state.text?.includes('not supported') && state.cards === 0, JSON.stringify(state));
        },
        screenshot: { name: "unsupported-model-guidance", requireText: ["本次任务未完成", "not supported"] },
      }),
    },
    {
      name: "Expanded process groups related commands by action",
      run: (ctx) => ctx.prove("Tool actions have matching icons and start collapsed, with commands available on expansion", {
        voiceover: vo[19],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showGroupedCommands()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.textContent.includes('已处理 3 个命令')");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button').click()");
          await ctx.waitFor("document.querySelectorAll('#streaming-answer-proof [data-testid=assistant-tool-action]').length === 2");
          const initiallyClosed = await ctx.eval("[...document.querySelectorAll('#streaming-answer-proof [data-testid=assistant-tool-action]')].every(node => !node.open && node.querySelector('summary svg'))");
          ctx.assert(initiallyClosed, "Tool action groups did not start closed with icons.");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-tool-action=command] summary').click()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-tool-action=command]')?.open === true");
          await ctx.eval("new Promise(resolve => setTimeout(resolve, 180))", { awaitPromise: true });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            const actions = [...host.querySelectorAll('[data-testid=assistant-tool-action]')];
            return { categories: actions.map(node => node.dataset.toolAction),
              labels: actions.map(node => node.firstElementChild?.textContent),
              onlyCommandOpen: !actions[0]?.open && actions[1]?.open,
              icons: actions.map(node => node.querySelector('summary svg')?.getAttribute('class')),
              arrowTransform: getComputedStyle(actions[1]?.querySelector('summary svg:last-child')).transform,
              commands: actions[1]?.textContent.includes("sed -n") && actions[1]?.textContent.includes("rg 'theme'"),
              resultOutside: !host.querySelector('[data-testid=assistant-process-column]')?.textContent.includes('文件已检查。') && host.querySelector('[data-assistant-result]')?.textContent.includes('文件已检查。'),
              fileCards: host.querySelectorAll('[data-assistant-result] .markdown-content > .chat-output-grid > .chat-output-card').length,
              fileBullets: host.querySelectorAll('[data-assistant-result] li .chat-output-card').length,
              resultGaps: (() => { const blocks = [...host.querySelectorAll('[data-assistant-result] .markdown-content > *')];
                return blocks.slice(1).map((block, index) => Math.round(block.getBoundingClientRect().top - blocks[index].getBoundingClientRect().bottom)); })() };
          })()`);
          ctx.assert(state.categories.join(',') === 'inspect,command' && state.labels.join(',') === '查看文件,运行命令'
            && state.onlyCommandOpen && state.icons[0]?.includes('lucide-file-search')
            && state.icons[1]?.includes('lucide-square-terminal') && state.arrowTransform !== 'none'
            && state.commands && state.resultOutside && state.fileCards === 2 && state.fileBullets === 0
            && state.resultGaps.every((gap) => Math.abs(gap - 8) <= 1), JSON.stringify(state));
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-tool-action=command] summary').click()");
          ctx.assert(await ctx.eval("document.querySelector('#streaming-answer-proof [data-tool-action=command]').open === false"), "Command group did not collapse again.");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-tool-action=command] summary').click()");
          await ctx.eval("new Promise(resolve => setTimeout(resolve, 180))", { awaitPromise: true });
        },
        screenshot: { name: "grouped-command-actions", requireText: ["查看文件", "运行命令", "palette.json", "design-tokens.css"] },
      }),
    },
    {
      name: "OpenCode separates reasoning from tool activity",
      run: (ctx) => ctx.prove("OpenCode shows animated thinking during reasoning and a lightweight action state while tools are active", {
        voiceover: vo[20],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showOpenCodeContinuation()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-loading]')?.textContent.includes('正在思考...')");
          const continuation = await ctx.eval(`(() => { const host = document.querySelector('#streaming-answer-proof'); return {
            loading: host.querySelectorAll('[data-testid=assistant-loading]').length,
            pending: host.querySelectorAll('[data-testid=assistant-result-pending]').length,
            labels: host.textContent.match(/正在思考/g)?.length ?? 0,
            letterAnimation: getComputedStyle(host.querySelector('.chat-thinking-label span')).animationName,
          }; })()`);
          ctx.assert(continuation.loading === 1 && continuation.pending === 0 && continuation.labels === 1
            && continuation.letterAnimation === 'chat-thinking-letter', JSON.stringify(continuation));
          await ctx.eval("window.__streamingAnswerProof.showOpenCodePhase('waiting')");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-loading]')?.textContent.includes('正在思考...')");
          ctx.assert(await ctx.eval("document.querySelectorAll('#streaming-answer-proof [data-testid=assistant-loading] .chat-thinking-dots span').length === 3"), "OpenCode waiting state lacks animated thinking dots.");
          await ctx.eval("window.__streamingAnswerProof.showOpenCodePhase('reasoning')");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-current-state]')?.textContent.includes('正在思考')");
          await ctx.eval("window.__streamingAnswerProof.showOpenCodePhase('tool')");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-tool-action=command]')?.textContent.includes('检查项目文件')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => { const host = document.querySelector('#streaming-answer-proof');
            return { pending: Boolean(host.querySelector('[data-testid=assistant-result-pending]')),
              currentState: host.querySelector('[data-testid=assistant-current-state]')?.textContent,
              activityKind: host.querySelector('[data-testid=assistant-live-activity]')?.getAttribute('data-activity-kind'),
              dots: host.querySelectorAll('[data-testid=assistant-result-pending] .chat-thinking-dots span').length,
              command: host.querySelector('[data-tool-action=command]')?.textContent,
              result: Boolean(host.querySelector('[data-assistant-result]')) }; })()`);
          ctx.assert(!state.pending && state.currentState?.includes('检查项目文件') && state.dots === 0 && state.command?.includes('检查项目文件') && !state.result, JSON.stringify(state));
        },
        screenshot: { name: "opencode-thinking-and-tool", requireText: ["运行命令", "检查项目文件"] },
      }),
    },
    {
      name: "Unphased output remains in stable body nodes",
      run: (ctx) => ctx.prove("Unphased text keeps stable body nodes across tools and completion", {
        voiceover: vo[21],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showOpenCodePhase('answer')");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-assistant]')?.textContent.includes('已找到相关文件。')");
          await ctx.eval("void (window.__orderedFirstText = document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-assistant]'))");
          ctx.assert(await ctx.eval("Boolean(document.querySelector('#streaming-answer-proof [data-assistant-result]'))"), "Streaming text lacks a body area.");
          await ctx.eval("window.__streamingAnswerProof.appendOpenCodeStep()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-final]')?.textContent.includes('目录确认完成。')");
          const ordered = await ctx.eval(`(() => {
            const host = document.querySelector('#streaming-answer-proof');
            const rows = [...host.querySelectorAll('[data-message-role=assistant]')];
            return { ids: rows.map(n => n.dataset.messageId), retained: host.querySelector('[data-message-id=opencode-proof-assistant]') === window.__orderedFirstText,
              result: Boolean(host.querySelector('[data-assistant-result]')) };
          })()`);
          ctx.assert(ordered.retained && ordered.result && ordered.ids.includes('opencode-proof-final') && ordered.ids.includes('opencode-proof-tool'), JSON.stringify(ordered));
          await ctx.eval("window.__streamingAnswerProof.finishOpenCode()");
          await ctx.waitFor("Array.from(document.querySelectorAll('#streaming-answer-proof [data-assistant-result]')).some(n=>n.textContent.includes('目录确认完成。'))");
        },
        assert: async () => {
          ctx.assert(await ctx.eval("!document.querySelector('#streaming-answer-proof [data-testid=assistant-result-pending], #streaming-answer-proof [data-testid=assistant-loading]')"), "Thinking remained visible after the answer began.");
        },
        screenshot: { name: "opencode-streaming-answer", requireText: ["目录确认完成。"] },
      }),
    },
    {
      name: "Post-processing remains in progress after the engine turn completes",
      run: (ctx) => ctx.prove("A completed engine turn still shows in progress while the iPolloWork app exports the video", {
        voiceover: vo[22],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showCompletedWhilePostProcessing()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column] button')?.textContent.includes('正在收尾')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const process = document.querySelector('#streaming-answer-proof [data-testid=assistant-process-column]');
            const label = process?.querySelector('button')?.textContent ?? '';
            return { label, result: document.querySelector('#streaming-answer-proof [data-assistant-result]')?.textContent ?? '' };
          })()`);
          ctx.assert(state.label.startsWith('正在收尾')
            && state.result.includes('iPolloWork 应用正在导出 MP4'), JSON.stringify(state));
        },
        screenshot: { name: "completed-engine-post-processing", requireText: ["正在收尾", "iPolloWork 应用正在导出 MP4"] },
      }),
    },
    {
      name: "Reference document card",
      run: ctx => ctx.prove("Compact document card separates filename and saved state", {
        voiceover: vo[24],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showReferenceCard()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]')?.textContent.includes('已保存')");
        },
        assert: async () => {
          const g = await ctx.eval(`(() => {const c=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]');const t=c.querySelector('[data-testid=artifact-file-title]');const d=c.querySelector('[data-testid=artifact-file-description]');return {height:c.getBoundingClientRect().height,width:c.getBoundingClientRect().width,titleSize:getComputedStyle(t).fontSize,titleLine:getComputedStyle(t).lineHeight,metaSize:getComputedStyle(d).fontSize,shadow:getComputedStyle(c).boxShadow,savedInside:c.querySelector('.artifact-file-saved')?.getBoundingClientRect().right<=d.getBoundingClientRect().right,text:c.textContent}})()`);
          ctx.assert(g.height===56 && g.width===360 && g.titleSize==='13px' && g.titleLine==='18px' && g.metaSize==='12px' && g.shadow==='none' && g.savedInside && g.text.includes('PDF') && g.text.includes('已保存'),JSON.stringify(g));
        }, screenshot:{name:"reference-document-card",requireText:["PDF","已保存"]},
      }),
    },
    {
      name: "Reference media card",
      run: ctx => ctx.prove("Image file keeps its compact thumbnail and saved state", {
        voiceover: vo[25],
        action:async()=>{await ctx.eval("window.__streamingAnswerProof.showUnmatchedImage()");await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell] .artifact-thumbnail')?.naturalWidth>0");},
        assert:async()=>{const g=await ctx.eval(`(()=>{const c=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]');const i=c.querySelector('.artifact-thumbnail').getBoundingClientRect();return {w:i.width,h:i.height,text:c.textContent}})()`);ctx.assert(g.w===52&&g.h===36&&g.text.includes('已保存'),JSON.stringify(g));},
        screenshot:{name:"reference-image-thumbnail",requireText:["已保存"]},
      }),
    },
    {
      name: "Reference narrow long filename",
      run: ctx => ctx.prove("Long filenames stay on one line with separate actions in narrow layouts", {
        voiceover:vo[26],
        action:async()=>{await ctx.client.send('Page.bringToFront');await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false});await ctx.eval("window.__streamingAnswerProof.showReferenceCard()");await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=artifact-file-title]')?.textContent.includes('正反馈')");},
        assert:async()=>{const g=await ctx.eval(`(()=>{const c=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]');const t=c.querySelector('[data-testid=artifact-file-title]');const a=c.querySelector('[data-testid=artifact-file-actions]');const tr=t.getBoundingClientRect(),ar=a.getBoundingClientRect(),cr=c.getBoundingClientRect(),s=getComputedStyle(t);return {line:s.whiteSpace,ellipsis:s.textOverflow,clipped:t.scrollWidth>t.clientWidth,gap:ar.left-tr.right,inside:ar.right<=cr.right,visible:getComputedStyle(a).opacity,title:t.title,text:t.textContent}})()`);ctx.assert(g.line==='nowrap'&&g.ellipsis==='ellipsis'&&g.clipped&&g.gap>=0&&g.inside&&g.visible==='1'&&g.title===g.text,JSON.stringify(g));},
        screenshot:{name:"reference-narrow-filename",requireText:["PDF","已保存"]},
      }),
    },
    {
      name: "Reference lightweight actions",
      run:ctx=>ctx.prove("Lightweight file actions remain accessible without covering the title",{
        voiceover:vo[27],
        action:async()=>{await ctx.trustedClick('#streaming-answer-proof [data-testid=artifact-file-more]');await ctx.waitFor("document.querySelector('[role=menu]')!==null");},
        assert:async()=>{const g=await ctx.eval(`(()=>{const c=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]');return {buttons:Array.from(c.querySelectorAll('[data-testid=artifact-file-actions] button')).map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,label:b.getAttribute('aria-label')})),menu:!!document.querySelector('[role=menu]')}})()`);ctx.assert(g.menu&&g.buttons.length===2&&g.buttons.every(b=>b.w===28&&b.h===28&&b.label),JSON.stringify(g));},
        screenshot:{name:"reference-file-actions",requireText:["复制文件路径"]},
      }).then(async()=>{await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:1104,height:900,deviceScaleFactor:1,mobile:false});}),
    },
    {
      name:"File card hover feedback",
      run:ctx=>ctx.prove("Card hover changes background and border without moving content",{
        voiceover:vo[28],
        action:async()=>{
          await ctx.eval("window.__streamingAnswerProof.showReferenceCard()");await ctx.waitFor("!!document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]')");
          await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
          await ctx.eval(`window.__cardMeasure=()=>{const e=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]');const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {bg:s.backgroundColor,border:s.borderColor,outline:s.outlineWidth,outlineColor:s.outlineColor,primary:(()=>{const p=document.createElement('span');p.style.color='var(--primary)';e.append(p);const color=getComputedStyle(p).color;p.remove();return color})(),w:r.width,h:r.height,x:r.x,y:r.y}};window.__cardIdle=window.__cardMeasure()`);
          const point=await ctx.eval(`(()=>{const e=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
          await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
          await ctx.waitFor("window.__cardMeasure().border!==window.__cardIdle.border");
        },
        assert:async()=>{const g=await ctx.eval("({idle:window.__cardIdle,hover:window.__cardMeasure()})");ctx.assert(g.idle.bg===g.hover.bg&&g.hover.border===g.hover.primary&&g.idle.w===g.hover.w&&g.idle.h===g.hover.h,JSON.stringify(g));await ctx.eval('window.__cardHover=window.__cardMeasure()');},
        screenshot:{name:'card-hover-feedback',requireText:['已保存']},
      }),
    },
    {
      name:"File card press feedback",
      run:ctx=>ctx.prove("Pressed card uses a stronger background and stays in place",{
        voiceover:vo[29],
        action:async()=>{const point=await ctx.eval(`(()=>{const r=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await ctx.waitFor('window.__cardMeasure().bg!==window.__cardHover.bg');},
        assert:async()=>{const g=await ctx.eval('({hover:window.__cardHover,press:window.__cardMeasure()})');ctx.assert(g.hover.bg!==g.press.bg&&g.hover.w===g.press.w&&g.hover.h===g.press.h&&g.hover.x===g.press.x&&g.hover.y===g.press.y,JSON.stringify(g));},
        screenshot:{name:'card-press-feedback',requireText:['已保存']},
      }).finally(async()=>{const point=await ctx.eval(`(()=>{const r=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}),
    },
    {
      name:"File card keyboard focus",
      run:ctx=>ctx.prove("Keyboard focus gives the file card a visible focus ring",{
        voiceover:vo[30],
        action:async()=>{await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]').focus()");await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]').matches(':focus-visible')");},
        assert:async()=>{const g=await ctx.eval('window.__cardMeasure()');ctx.assert(parseFloat(g.outline)>=2&&g.outlineColor===g.primary,JSON.stringify(g));},
        screenshot:{name:'card-keyboard-focus',requireText:['已保存']},
      }),
    },
    {
      name:"File card download busy",
      run:ctx=>ctx.prove("Downloading disables only download and does not open the file",{
        voiceover:vo[31],
        action:async()=>{await ctx.eval("window.__streamingAnswerProof.downloadBaseline=window.__streamingAnswerProof.downloadRequests||0;window.__streamingAnswerProof.openedPath=null;window.__streamingAnswerProof.downloadGate=new Promise(resolve=>window.__streamingAnswerProof.releaseDownload=resolve)");await ctx.trustedClick('#streaming-answer-proof [data-testid=artifact-file-actions] button:first-child');await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=artifact-file-actions] button:first-child')?.disabled");},
        assert:async()=>{const g=await ctx.eval(`(()=>{const c=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-shell]'),b=c.querySelector('[data-testid=artifact-file-actions] button');return {busy:b.getAttribute('aria-busy'),requests:window.__streamingAnswerProof.downloadRequests-window.__streamingAnswerProof.downloadBaseline,spinner:!!b.querySelector('.animate-spin'),cardDisabled:c.querySelector('[data-testid=artifact-file-card]').disabled,opened:window.__streamingAnswerProof.openedPath,downloaded:window.__streamingAnswerProof.downloadedPath}})()`);ctx.assert(g.busy==='true'&&g.requests===1&&g.spinner&&!g.cardDisabled&&!g.opened&&g.downloaded.endsWith('.pdf'),JSON.stringify(g));},
        screenshot:{name:'card-download-busy',requireText:['已保存']},
      }).finally(async()=>{await ctx.eval('window.__streamingAnswerProof.releaseDownload();window.__streamingAnswerProof.downloadGate=undefined');await ctx.waitFor("!document.querySelector('#streaming-answer-proof [data-testid=artifact-file-actions] button:first-child')?.disabled");}),
    },
    {
      name: "Text interruption keeps one shared Alert despite historical image",
      run: ctx => ctx.prove("An interrupted text turn retains its recovery hint in the shared warning Alert, independent of previous image status", {
        voiceover: vo[32],
        action: async () => {
          await ctx.eval("window.__streamingAnswerProof.showStoppedText()");
          await ctx.waitFor("document.querySelector('#streaming-answer-proof [data-testid=run-issue-notice]')?.dataset.slot==='alert'");
          await ctx.eval("document.querySelector('#streaming-answer-proof [data-testid=run-issue-notice]').scrollIntoView({block:'center'})");
        },
        assert: async () => {
          const state = await ctx.eval(`(()=>{const h=document.querySelector('#streaming-answer-proof'),e=h.querySelector('[data-testid=run-issue-notice]'),s=getComputedStyle(e),p=document.createElement('span');p.style.backgroundColor='var(--feedback-warning-background)';h.append(p);const bg=getComputedStyle(p).backgroundColor;p.remove();return {count:h.querySelectorAll('[data-testid=run-issue-notice]').length,shared:e.dataset.slot==='alert',icon:!!e.querySelector('svg'),semantic:s.backgroundColor===bg,border:s.borderTopWidth,text:e.textContent}})()`);
          ctx.assert(state.count===1&&state.shared&&state.icon&&state.semantic&&state.border==='0px'&&state.text.includes('可以继续发送消息'),JSON.stringify(state));
        },
        screenshot:{name:'text-stop-shared-alert',requireText:['任务已中断','可以继续发送消息']},
      }),
    },
    {
      name: "Composer text matches conversation typography",
      run: async (ctx) => {
        let placeholderStyle;
        await ctx.prove("The composer uses the shared 13px text and 20px line height for typed and placeholder text", {
          voiceover: vo[23],
          action: async () => {
            await ctx.eval("window.__streamingAnswerProof.cleanup()");
            await ctx.waitFor("Boolean(document.querySelector('[contenteditable=true][data-lexical-editor=true]')) && window.__ipolloworkControl.listActions().some(action => action.id === 'composer.set_text' && !action.disabled)");
            placeholderStyle = await ctx.eval(`(() => {
              const placeholder = document.querySelector('[data-testid=composer-placeholder]');
              if (!placeholder) return null;
              const style = getComputedStyle(placeholder);
              return [style.fontSize, style.lineHeight];
            })()`);
            await ctx.control("composer.set_text", { text: "第一行\n第二行" });
            await ctx.waitFor("document.querySelector('[contenteditable=true][data-lexical-editor=true]')?.textContent.includes('第二行')");
          },
          assert: async () => {
            const styles = await ctx.eval(`(() => {
              const editor = document.querySelector('[contenteditable=true][data-lexical-editor=true]');
              const read = (element) => { const style = getComputedStyle(element); return [style.fontSize, style.lineHeight]; };
              return { editor: read(editor), paragraph: editor.querySelector('p') ? read(editor.querySelector('p')) : null };
            })()`);
            ctx.assert(Object.values({ ...styles, placeholder: placeholderStyle }).filter(Boolean).every(([size, height]) => size === "13px" && height === "20px"), JSON.stringify({ ...styles, placeholder: placeholderStyle }));
          },
          screenshot: { name: "composer-multiline-typography", requireText: ["第一行", "第二行"] },
        });
        await ctx.control("composer.set_text", { text: "" });
      },
    },
  ],
};
