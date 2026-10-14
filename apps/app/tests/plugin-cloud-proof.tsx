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

localStorage.setItem("ipollowork.language", "zh");
writeDenSettings({ baseUrl: "http://127.0.0.1:5399", authToken: "cloud-proof", activeOrgId: null, activeOrgSlug: null, activeOrgName: null });
const client = createiPolloWorkServerClient({ baseUrl: "http://127.0.0.1:5398", token: "cloud-proof" });
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
      <Button data-testid="proof-update" variant="outline" onClick={() => void change("update")}>发布新版</Button>
      <Button data-testid="proof-corrupt" variant="outline" onClick={() => void change("corrupt")}>损坏新版</Button>
      <Button data-testid="proof-offline" variant="outline" onClick={() => void change("offline")}>云端断开</Button>
      <Button data-testid="proof-list" variant="outline" onClick={() => setSelected(null)}>返回列表</Button>
    </div>
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
createRoot(document.getElementById("root")!).render(<HashRouter><CloudSessionProvider><Proof /></CloudSessionProvider></HashRouter>);
