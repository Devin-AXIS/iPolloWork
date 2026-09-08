// Production video iframe, host bridge and Image Studio; only paid AI is faked.
import React, { useRef } from "react";
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
  listPluginPackages: async () => ({ items: [{ enabled: true, pluginId: "image-studio", name: "图片工作台", disabledResourceIds: [], manifest: setup.manifest }] }),
  getPluginPackageUiResource: async () => ({ pluginId: "image-studio", resource: setup.resource, html: setup.html }),
  downloadWorkspaceFile: async (_id, path) => ({ data: await (await fetch(endpoint + "/raw?path=" + encodeURIComponent(path))).arrayBuffer() }),
  callExtensionAction: async input => (await fetch(endpoint + "/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: input.action, args: input.args }) })).json(),
};
function Fixture() {
  const ref = useRef(null);
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
    <header className="border-b px-4 py-2 text-sm">视频图片联动验证 · 真实编辑界面与本地保存，AI 响应为模拟测试图</header>
    <section style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <iframe ref={ref} src={studioUrl} title="Video Studio" style={{ width: "100%", height: "100%", border: 0 }} />
      <VideoImageWorkbench client={client} workspaceId="selection-proof" workspaceRoot={setup.root} sessionId="selection-proof" studioUrl={studioUrl} studioFrameRef={ref} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")).render(<HashRouter><QueryClientProvider client={getReactQueryClient()}><TooltipProvider><PlatformProvider value={createDefaultPlatform()}><LocalProvider><ShellConfigProvider><Fixture /></ShellConfigProvider></LocalProvider></PlatformProvider></TooltipProvider></QueryClientProvider></HashRouter>);
