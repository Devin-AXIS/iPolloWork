import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { WorkspaceAppFrame } from "../../apps/app/src/react-app/plugin-ui/workspace-app-frame";
import { SessionSurface } from "../../apps/app/src/react-app/domains/session/surface/session-surface";
import { mapCodexHarnessSnapshot } from "../../apps/app/src/react-app/domains/session/engine/codex-harness-conversation-mapper";
import { ConversationOutputPanel } from "../../apps/app/src/components/chat/artifact";
import { LocalProvider } from "../../apps/app/src/react-app/kernel/local-provider";
import { ShellConfigProvider } from "../../apps/app/src/react-app/shell/shell-config";
import { PlatformProvider, createDefaultPlatform } from "../../apps/app/src/react-app/kernel/platform";
import { TooltipProvider } from "../../apps/app/src/components/ui/tooltip";
import { getReactQueryClient } from "../../apps/app/src/react-app/infra/query-client";
import { setLocale } from "../../apps/app/src/i18n";
import { IPolloWorkControlProvider } from "../../apps/app/src/react-app/shell/control/control-provider";
import "../../apps/app/src/app/index.css";

const endpoint = "http://127.0.0.1:5190";
setLocale("zh");
const setup = await (await fetch(endpoint + "/setup")).json();
if (setup.historyMode) {
  const base = document.createElement("base");
  base.href = new URL("/", import.meta.url).href;
  document.head.prepend(base); // Serve production starter/brand assets from Vite.
}
const queryClient = getReactQueryClient();
const noop = () => {};
const empty = async () => [];
const initialSnapshot = {
  session: { id: "selection-proof", title: "图片选区修改验证", directory: "", time: { created: 1, updated: 1 } },
  messages: [{ id: "intro", role: "assistant", parts: [{ type: "text", text: "请在右侧画出选区，然后点击 AI 批注交给左侧对话。" }] }],
  todos: [], status: { type: "idle" },
};
const client = {
  baseUrl: endpoint,
  getSessionSnapshot: async (_workspace, id) => {
    if (!setup.historyMode) return { item: initialSnapshot };
    const response = await fetch(endpoint + "/history/snapshot?id=" + encodeURIComponent(id));
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    return result;
  },
  listHyperframesCatalog: async () => ({ items: [] }),
  resolveArtifacts: async () => ({ items: [] }),
  listPluginPackages: async () => ({ items: [] }),
  listSessionArtifacts: async () => (await fetch(endpoint + "/artifacts")).json(),
  async callExtensionAction(input) {
    const result = await (await fetch(endpoint + "/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: input.action, args: input.args }) })).json();
    return result;
  },
};
function Fixture() {
  const [videoBrief, setVideoBrief] = useState("");
  const [historyId, setHistoryId] = useState(null);
  const [output, setOutput] = useState(null);
  const [showStudio, setShowStudio] = useState(true);
  const [showFiles, setShowFiles] = useState(false);
  const [launch, setLaunch] = useState({ intent: "edit-image", source: { path: "source.png" } });
  const [dispatch, setDispatch] = useState("");
  const send = async (draft) => {
    if (setup.historyMode) {
      await fetch(endpoint + "/history/send?id=" + historyId, { method: "POST" });
      await queryClient.invalidateQueries();
      return false;
    }
    const serialized = draft.capability?.instruction.split("\n").find(line => line.startsWith('{"selectionId"'));
    if (!serialized) { setDispatch("普通对话：未附加选区"); return false; }
    const args = JSON.parse(serialized);
    setDispatch("已冻结图片选区；开始模拟生成");
    const response = await (await fetch(endpoint + "/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direct: true, action: "image_edit", args: { ...args, prompt: draft.text } }) })).json();
    if (!response.ok) throw new Error(response.message);
    setOutput(response.result);
    setDispatch("已保存新图片；原图未覆盖");
    return false; // Simulated transport: do not start an external agent turn.
  };
  if (setup.framesMode) return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
    <header className="border-b px-5 py-3 text-sm">视频参数验证 · 真实控件和消息桥，模拟 AI 和视频服务，不扣费
      {videoBrief ? <details className="mt-2"><summary>当前会话收到扩写请求（模拟）</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">{videoBrief}</pre></details> : null}
      {videoBrief ? <button className="mt-2 rounded border p-2" onClick={async () => {
        window.__ipolloworkControl.setEnabled(true);
        const requestId=videoBrief.match(/requestId=([a-f0-9-]+)/)?.[1];
        await window.__ipolloworkControl.execute("workspace_app.call_tool",{name:"accept_expanded_prompt",arguments:{requestId,prompt:"integrated_multimodal_description: [Shot 1] Kuafu runs across the wilderness holding a staff, pursuing the setting sun. Epic cinematic style, low-angle tracking shot, golden sunset. overall_soundscape: footsteps and wind. non_diegetic_music: drums."}});
      }}>模拟 AI 回填并自动提交模拟视频</button> : null}
    </header>
    <section className="min-h-0 flex-1"><WorkspaceAppFrame
      surface={{ id: "video-console", pluginId: "video-console", label: "视频控制台", resource: setup.resource }}
      client={client} workspaceId="selection-proof" workspaceRoot="" sessionId="selection-proof" placement="workspace"
      resourceOverride={{ pluginId: "video-console", resource: setup.resource, html: setup.html }}
      onSendMessage={async ({text}) => { setVideoBrief(text); return true; }}
    /></section>
  </main>;
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
    <header className="border-b px-5 py-3 flex items-center gap-4">
      <b>{setup.historyMode ? "模板新会话 · 历史读取验证" : "图片选区修改 · 界面验证"}</b>
      <span className="text-xs text-muted-foreground">{setup.historyMode ? "真实界面和服务端，模拟引擎回复，不调用收费接口" : "真实界面和图片处理；AI 返回整幅蓝色测试图，不调用收费接口"}</span>
      {!setup.historyMode ? <>
        <button onClick={() => setShowStudio(value => !value)}>{showStudio ? "关闭工作台" : "打开工作台"}</button>
        <button onClick={() => { setLaunch({ intent: "edit-image", source: { path: "source.png" } }); setShowStudio(true); }}>重新打开原图</button>
        <button onClick={() => setShowFiles(value => !value)}>{showFiles ? "显示对话" : "显示主要产出"}</button>
      </> : null}
      {setup.historyMode ? <button onClick={async () => {
        const result = await (await fetch(endpoint + "/history/create", { method: "POST" })).json();
        setHistoryId(result.thread.id); setShowStudio(false);
      }}>验证模板新会话</button> : null}
    </header>
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <section style={{ width: "min(34vw, 440px)", flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }} className="border-r">
        <div className="flex-1 min-h-0">{showFiles ? <ConversationOutputPanel
          messages={[]} sessionId="selection-proof" sessionTitle="图片编辑保存验证" client={client} workspaceId="selection-proof" workspaceRoot=""
          onOpenTarget={target => { setLaunch({ intent: "edit-image", source: { path: target.value } }); setShowStudio(true); }}
        /> : setup.historyMode && !historyId ? <p className="p-6">点击“验证模板新会话”，检查 AI 热点拆解首次发言前的对话区。</p> : <SessionSurface
          key={historyId ?? "selection-proof"}
          client={client} conversation={{ mapSnapshot: setup.historyMode ? mapCodexHarnessSnapshot : value => value }} workspaceId="selection-proof" workspaceRoot="" sessionId={historyId ?? "selection-proof"}
          opencodeBaseUrl={endpoint} ipolloworkToken="" developerMode={false}
          modelLabel="GPT-5.5" onModelClick={noop} modelPickerOpen={false} selectedModel={{ providerID: "openai", modelID: "gpt-5.5" }}
          onModelPickerOpenChange={noop} onModelChange={noop} onSendDraft={send} onDraftChange={noop} supportsNativeAttachments
          modelVariantLabel="均衡" modelVariant={null} onModelVariantChange={noop}
          selectedMode={null} listModes={empty} onSelectMode={noop} listAgents={empty} onSelectAgent={noop} listCommands={empty}
          recentFiles={[]} searchFiles={empty} isRemoteWorkspace={false} isSandboxWorkspace={false} providerConnectedCount={1}
        />}</div>
        {dispatch ? <p role="status" className="p-3 text-xs">{dispatch}</p> : null}
        {output ? <button className="m-3 rounded-lg border p-3 text-left" onClick={() => { setLaunch({ intent: "edit-image", source: { path: output.path } }); setShowStudio(true); }}>
          <img src={output.dataUrl} className="w-48 rounded" alt="选区编辑结果" />
          <span className="text-xs">{output.path} · 在右侧打开</span>
        </button> : null}
      </section>
      <section style={{ flex: 1, minWidth: 0 }}>{setup.historyMode ? <div className="p-10"><h1 className="text-xl font-semibold">AI 热点拆解 · 新会话历史回归</h1><p className="mt-4">真实 SessionSurface、消息映射与服务端读取；引擎模拟空会话报错及固定回复，不生成视频。</p></div> : showStudio ? <WorkspaceAppFrame
        surface={{ id: "image-studio", pluginId: "image-studio", label: "图片工作台", resource: setup.resource }}
        client={client} workspaceId="selection-proof" workspaceRoot="" sessionId="selection-proof" placement="workspace"
        resourceOverride={{ pluginId: "image-studio", resource: setup.resource, html: setup.html }}
        launch={launch}
      /> : <div className="p-10">工作台已关闭，已发送的选区快照不受影响。</div>}</section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")).render(<HashRouter><QueryClientProvider client={queryClient}><TooltipProvider><PlatformProvider value={createDefaultPlatform()}><LocalProvider><ShellConfigProvider><IPolloWorkControlProvider><Fixture /></IPolloWorkControlProvider></ShellConfigProvider></LocalProvider></PlatformProvider></TooltipProvider></QueryClientProvider></HashRouter>);
