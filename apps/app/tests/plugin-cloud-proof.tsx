/** @jsxImportSource react */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../src/app/index.css";
import { writeDenSettings } from "../src/app/lib/den";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { CloudSessionProvider, useCloudSession } from "../src/react-app/domains/settings/cloud/cloud-session-provider";
import { PluginPackagesPanel, type PluginPackagesPanelHandle } from "../src/react-app/domains/settings/plugin-packages-panel";
import { CloudMarketplacesView } from "../src/react-app/domains/settings/pages/cloud-marketplaces-view";
import { Button } from "../src/components/ui/button";
import { Toaster } from "../src/components/ui/sonner";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { parsePluginPackageManifest } from "@ipollowork/types/plugins";
import deepSeekManifest from "../../../examples/plugin-packages/deepseek-harness/ipollowork.plugin.json";
import { PluginPackageListItem } from "../src/react-app/domains/settings/plugin-package-list-item";

localStorage.setItem("ipollowork.language", "zh");
writeDenSettings({ baseUrl: "http://127.0.0.1:5399", authToken: "cloud-proof", activeOrgId: null, activeOrgSlug: null, activeOrgName: null });
const baseClient = createiPolloWorkServerClient({ baseUrl: "http://127.0.0.1:5398", token: "cloud-proof" });
let failNextLocalInstall = false;
const client = { ...baseClient, installBundledPluginPackage: async (workspaceId: string, pluginId: string) => {
  if (failNextLocalInstall) {
    failNextLocalInstall = false;
    throw Object.assign(new Error("Install targets already exist with different content"), {
      code: "plugin_package_conflict", details: { paths: [".opencode/skills/local-workflow/SKILL.md"] },
    });
  }
  return baseClient.installBundledPluginPackage(workspaceId, pluginId);
} };
function Proof() {
  const cloud = useCloudSession();
  const ref = useRef<PluginPackagesPanelHandle>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { cloud.setIsSignedIn(true); }, [cloud.setIsSignedIn]);
  async function change(kind: string) {
    await fetch("http://127.0.0.1:5399/proof/" + kind, { method: "POST" });
    setSelected(null); ref.current?.refresh();
  }
  return <main className="min-h-screen bg-background text-foreground">
    <div className="border-b p-4 text-sm flex gap-3 items-center">
      <span>隔离验证：云端目录模拟，安装与更新使用真实服务</span>
      <Button data-testid="proof-install-conflict" variant="outline" onClick={() => { failNextLocalInstall = true; }}>模拟安装冲突</Button>
      <Button data-testid="proof-local-update" variant="outline" onClick={() => void change("local-update")}>本地新版</Button>
      <Button data-testid="proof-update" variant="outline" onClick={() => void change("update")}>发布新版</Button>
      <Button data-testid="proof-corrupt" variant="outline" onClick={() => void change("corrupt")}>损坏新版</Button>
      <Button data-testid="proof-offline" variant="outline" onClick={() => void change("offline")}>云端断开</Button>
      <Button data-testid="proof-list" variant="outline" onClick={() => setSelected(null)}>返回列表</Button>
    </div>
    <Toaster />
    <div className="mx-auto max-w-5xl p-8">
      <PluginPackagesPanel ref={ref} client={client} workspaceId="cloud-proof" selectedPluginId={selected}
        onSelectPlugin={setSelected} onOpenUrl={() => {}} mcpStatuses={{}} onConnectMcp={async () => null}
        onLogoutMcpAuth={() => {}} onRelationshipsChange={() => {}}
        marketplaceView={(search, filters, installed, catalog) =>
          <CloudMarketplacesView client={client} workspaceId="cloud-proof" embedded search={search}
            categoryFilter={filters.category} statusFilter={filters.status} installedPackages={installed} catalog={catalog}
            onOpenAccount={() => {}} onOpenInstalled={setSelected}
            onInstalled={() => { ref.current?.refresh(); }} />} />
    </div>
  </main>;
}
function LayoutProof() {
  const manifest = parsePluginPackageManifest(deepSeekManifest);
  const entries = [
    { id: "figma", name: "Figma", authorization: true },
    { id: "deepseek-harness", name: "DeepSeek Harness 协作智能体与长名称工作台", authorization: false },
    { id: "github", name: "GitHub", authorization: true },
    { id: "ipollo-onto", name: "iPollo Onto", authorization: false },
    { id: "notion", name: "Notion", authorization: true },
    { id: "stripe", name: "Stripe", authorization: true },
  ];
  return <main className="mx-auto min-h-screen max-w-5xl bg-background p-4 text-foreground">
    <Button className="mb-4" variant="outline" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>切换主题</Button>
    <div data-testid="plugin-layout-list" className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
      {entries.map(entry => <PluginPackageListItem key={entry.id} compact
        manifest={{ ...manifest, id: entry.id, name: entry.name, description: "多模型与智能体工作台：支持设计稿、文档、项目管理、协作流程以及跨平台内容运营。" }}
        version="0.4.19+dev.c9adc5364e2498b53ae1abcdef1234567890"
        badge={<span className="inline-flex h-4 items-center rounded-full bg-gray-3 px-1.5 text-[10px] leading-none text-gray-11">OpenCode 生效友好</span>}
        status={<span className="inline-flex items-center gap-1.5">{entry.authorization ? <KeyRound size={13} /> : <CheckCircle2 size={13} />}{entry.authorization ? "需要授权" : "已安装"}</span>}
        actionLabel={entry.authorization ? "授权连接" : "打开"} onAction={() => {}} onOpen={() => {}}
        secondaryAction={<Button variant="ghost" size="sm" aria-label={`卸载 ${entry.name}`}><Trash2 size={14} /></Button>} />)}
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).has("layout")
  ? <LayoutProof />
  : <HashRouter><CloudSessionProvider><Proof /></CloudSessionProvider></HashRouter>);
