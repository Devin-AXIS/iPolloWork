import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { WorkspaceAppFrame } from "../../apps/app/src/react-app/plugin-ui/workspace-app-frame";
import { SessionSurface } from "../../apps/app/src/react-app/domains/session/surface/session-surface";
import { ConversationOutputPanel } from "../../apps/app/src/components/chat/artifact";
import { LocalProvider } from "../../apps/app/src/react-app/kernel/local-provider";
import { ShellConfigProvider } from "../../apps/app/src/react-app/shell/shell-config";
import { PlatformProvider, createDefaultPlatform } from "../../apps/app/src/react-app/kernel/platform";
import { TooltipProvider } from "../../apps/app/src/components/ui/tooltip";
import { getReactQueryClient } from "../../apps/app/src/react-app/infra/query-client";
import { setLocale } from "../../apps/app/src/i18n";
import "../../apps/app/src/app/index.css";

const endpoint = "http://127.0.0.1:5190";
setLocale("zh");
const setup = await (await fetch(endpoint + "/setup")).json();
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
  getSessionSnapshot: async () => ({ item: initialSnapshot }),
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
  const [output, setOutput] = useState(null);
  const [showStudio, setShowStudio] = useState(true);
  const [showFiles, setShowFiles] = useState(false);
  const [launch, setLaunch] = useState({ intent: "edit-image", source: { path: "source.png" } });
  const [dispatch, setDispatch] = useState("");
  const send = async (draft) => {
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
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
    <header className="border-b px-5 py-3 flex items-center gap-4">
      <b>图片选区修改 · 界面验证</b>
      <span className="text-xs text-muted-foreground">真实界面和图片处理；AI 返回整幅蓝色测试图，不调用收费接口</span>
      <button onClick={() => setShowStudio(value => !value)}>{showStudio ? "关闭工作台" : "打开工作台"}</button>
      <button onClick={() => { setLaunch({ intent: "edit-image", source: { path: "source.png" } }); setShowStudio(true); }}>重新打开原图</button>
      <button onClick={() => setShowFiles(value => !value)}>{showFiles ? "显示对话" : "显示主要产出"}</button>
    </header>
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <section style={{ width: "min(34vw, 440px)", flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }} className="border-r">
        <div className="flex-1 min-h-0">{showFiles ? <ConversationOutputPanel
          messages={[]} sessionId="selection-proof" sessionTitle="图片编辑保存验证" client={client} workspaceId="selection-proof" workspaceRoot=""
          onOpenTarget={target => { setLaunch({ intent: "edit-image", source: { path: target.value } }); setShowStudio(true); }}
        /> : <SessionSurface
          client={client} conversation={{ mapSnapshot: value => value }} workspaceId="selection-proof" workspaceRoot="" sessionId="selection-proof"
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
      <section style={{ flex: 1, minWidth: 0 }}>{showStudio ? <WorkspaceAppFrame
        surface={{ id: "image-studio", pluginId: "image-studio", label: "图片工作台", resource: setup.resource }}
        client={client} workspaceId="selection-proof" workspaceRoot="" sessionId="selection-proof" placement="workspace"
        resourceOverride={{ pluginId: "image-studio", resource: setup.resource, html: setup.html }}
        launch={launch}
      /> : <div className="p-10">工作台已关闭，已发送的选区快照不受影响。</div>}</section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")).render(<HashRouter><QueryClientProvider client={queryClient}><TooltipProvider><PlatformProvider value={createDefaultPlatform()}><LocalProvider><ShellConfigProvider><Fixture /></ShellConfigProvider></LocalProvider></PlatformProvider></TooltipProvider></QueryClientProvider></HashRouter>);
