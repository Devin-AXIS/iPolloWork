// Production video iframe, host bridge and Image Studio; only paid AI is faked.
import React, { useRef, useState } from "react";
import { DesignPanel } from "../../apps/app/src/react-app/domains/session/design/design-panel";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { VideoImageWorkbench } from "../../apps/app/src/react-app/domains/session/video/video-image-workbench";
import { LocalProvider } from "../../apps/app/src/react-app/kernel/local-provider";
import { ShellConfigProvider } from "../../apps/app/src/react-app/shell/shell-config";
import { PlatformProvider, createDefaultPlatform } from "../../apps/app/src/react-app/kernel/platform";
import { TooltipProvider } from "../../apps/app/src/components/ui/tooltip";
import { getReactQueryClient } from "../../apps/app/src/react-app/infra/query-client";
import { setLocale } from "../../apps/app/src/i18n";
import "../../apps/app/src/app/index.css";

const endpoint = "http://127.0.0.1:5274";
const studioUrl = "http://localhost:5192/#project/selection-proof?v=1&t=0&tab=design&rc=1&tv=1&locale=zh&ipolloworkTheme=light";
setLocale("zh");
const setup = await (await fetch(endpoint + "/setup")).json();
const client = {
  baseUrl: endpoint,
  listPluginPackages: async () => ({ items: [setup.manifest, setup.videoManifest].filter(Boolean).map(manifest => ({ enabled: true, pluginId: manifest.id, name: manifest.name, disabledResourceIds: [], manifest })) }),
  getPluginPackageUiResource: async (_workspace, pluginId) => pluginId === "video-console" ? ({ pluginId, resource: setup.videoManifest.resources.find(item => item.type === "ui"), html: setup.videoHtml }) : ({ pluginId: "image-studio", resource: setup.resource, html: setup.html }),
  getTemplateSession: async () => { throw new Error("Direct HTML fixture"); },
  readWorkspaceFile: async (_workspace, path) => { const response=await fetch(endpoint+"/file?path="+encodeURIComponent(path));if(!response.ok)throw new Error("File missing");return response.json(); },
  writeWorkspaceFile: async (_workspace, payload) => (await fetch(endpoint+"/file?path="+encodeURIComponent(payload.path),{method:"POST",body:JSON.stringify(payload)})).json(),
  uploadWorkspaceMedia: async (_workspace, path, file) => { const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return(await fetch(endpoint+"/file?path="+encodeURIComponent(path),{method:"POST",body:JSON.stringify({dataBase64:btoa(binary)})})).json(); },
  downloadWorkspaceFile: async (_id, path) => ({ data: await (await fetch(endpoint + "/raw?path=" + encodeURIComponent(path))).arrayBuffer() }),
  callExtensionAction: async input => (await fetch(endpoint + "/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: input.action, args: input.args, pluginId: input.extensionId?.replace("plugin:", "") }) })).json(),
};
function Fixture() {
  const ref = useRef(null);
  const [surface, setSurface] = useState(setup.designPage ? "design" : "video");
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
    <header className="border-b px-4 py-2 text-sm">视频图片联动验证 · 真实编辑界面与本地保存，AI 响应为模拟测试图
      {setup.designPage ? <span className="ml-4 space-x-4"><button onClick={()=>setSurface("design")}>Design 验证</button><button onClick={()=>setSurface("video")}>Video Studio 验证</button></span> : null}
    </header>
    <section style={{ position: "relative", flex: 1, minHeight: 0 }}>
      {surface === "design" ? <DesignPanel client={client} mediaClient={client} workspaceId="selection-proof" workspaceRoot={setup.root} sessionId="selection-proof" initialPath={setup.designPage} onAskAi={()=>{}} /> : <iframe ref={ref} src={studioUrl} title="Video Studio" style={{ width: "100%", height: "100%", border: 0 }} />}
      <VideoImageWorkbench client={client} workspaceId="selection-proof" workspaceRoot={setup.root} sessionId="selection-proof" studioUrl={studioUrl} studioFrameRef={ref} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")).render(<HashRouter><QueryClientProvider client={getReactQueryClient()}><TooltipProvider><PlatformProvider value={createDefaultPlatform()}><LocalProvider><ShellConfigProvider><Fixture /></ShellConfigProvider></LocalProvider></PlatformProvider></TooltipProvider></QueryClientProvider></HashRouter>);
