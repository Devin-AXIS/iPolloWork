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
import { SkillsView, type SkillsExtensionsStore } from "../src/react-app/domains/settings/pages/skills-view";
import { saveEnterpriseConnection, setEnterpriseConnectionAccount, type EnterpriseConnection } from "../src/app/lib/enterprise-connections";


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
const sourceProof = new URLSearchParams(location.search).has("sources");
if (sourceProof) {
  const connection: EnterpriseConnection = { id: "ent_cards", name: "卡片样式企业", shortName: "企业", origin: "https://cards-proof.invalid", authMode: "ipollo_oidc", logoUrl: null, accent: "blue", membership: { id: "member", role: "member", status: "active" }, session: { token: "synthetic-cards-session", expiresAt: "2099-01-01T00:00:00Z" }, features: { skills: true, membership: true } };
  setEnterpriseConnectionAccount({ userId: "cards-proof", baseUrl: "http://127.0.0.1:5399", token: "cloud-proof" });
  saveEnterpriseConnection(connection);
  localStorage.setItem("ipollowork.work-context.v1", "enterprise:ent_cards");
  const description = "整理团队协作流程，连接常用工具并生成清晰的执行步骤。长说明保持两行，与个人卡片的间距和字号一致。";
  const manifest = parsePluginPackageManifest({ schemaVersion: 2, id: "figma", name: "设计协作助手", description, category: "Design", resources: [], source: { format: "ipollowork-extension-manifest", origin: "local", trusted: true }, package: { version: "1.0.0", updateId: "proof/figma" } });
  const personal = [{ name: "工作流规划技能", path: ".opencode/skills/workflow/SKILL.md", description, scope: "project", pluginName: null, canExport: true, source: { origin: "public", resourceId: "skill-shared", version: "1.0.0", digest: "0".repeat(64) } }];
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!["127.0.0.1", "cards-proof.invalid"].includes(url.hostname)) return originalFetch(input, init);
    const path = url.pathname;
    if (path.endsWith("/plugin-packages")) return Response.json({ items: [{ pluginId: "figma", name: manifest.name, version: "1.0.0", enabled: true, disabledResourceIds: [], previousVersion: null, manifest, integrity: { sha256: "0".repeat(64), status: "verified" } }] });
    if (path.endsWith("/catalog")) return Response.json({ items: [] });
    if (path.endsWith("/skill-packages")) return Response.json({ personal, enterprise: [] });
    if (path.endsWith("/skill-packages/context")) return Response.json({ ok: true });
    if (path.includes("/skills/")) return Response.json({ content: "# 工作流规划技能\n整理目标、分析步骤并生成执行计划。" });
    if (path.endsWith("/membership")) return Response.json({ membership: { ...connection.membership, displayName: "验证成员", email: "member@example.test" } });
    if (path.endsWith("/client-manifest")) return Response.json({ schemaVersion: 1, revision: 1, enterprise: { id: connection.id, name: connection.name, shortName: "企业", logoUrl: null, accent: "blue" }, features: connection.features, labels: { templateSource: "企业", extensionSource: "企业", skillSource: "企业" } });
    if (path === "/api/v1/skills") return Response.json({ items: ["skill-shared", "skill-new"].map((id, i) => ({ id, type: "skill", name: i ? "new-workflow" : "workflow", title: i ? "团队资料归档技能与长名称换行验证" : "工作流规划技能", description, category: "productivity", authorName: "iPollo 团队", updatedAt: "2026-10-22T00:00:00Z", latestVersion: { version: "2.0.0", digest: "0".repeat(64), minimumAppVersion: "0.50.18" } })), nextCursor: null });
    if (path.endsWith("/resources") || path.endsWith("/enterprise-resources")) {
      const type = url.searchParams.get("type") || "extension";
      const resources = [0, 1].map(i => ({ id: type + "-" + i, type, status: "published", slug: i ? "github" : "figma", sourceTemplateId: i ? "github" : "figma", name: type === "skill" ? i ? "团队资料归档技能与长名称换行验证" : "工作流规划技能" : i ? "代码协作助手与长名称自动截断验证" : "设计协作助手", description, category: "productivity", enterpriseCategory: "效率协作", updatedAt: "2026-10-22T00:00:00Z", latestVersion: { version: "2.0.0", digest: "0".repeat(64), downloadPath: "/api/v1/resources/" + type + "-" + i + "/versions/2.0.0/download" }, latestArtifact: { version: "2.0.0", manifestId: i ? "github" : "figma", sha256: "0".repeat(64), downloadPath: "/api/v1/enterprise-resources/" + type + "-" + i + "/versions/2.0.0/download" } }));
      return Response.json(path.endsWith("/enterprise-resources") ? { resources } : { items: resources, nextCursor: null });
    }
    return Response.json({ items: [], methods: [], accounts: [], connected: false });
  };
}
const noop = () => {};
const unavailable = async () => ({ ok: false, message: "Display fixture" });
const skillExtensions: SkillsExtensionsStore = {
  skills: () => [], skillsStatus: () => null, hubSkills: () => [], hubSkillsStatus: () => null, cloudOrgSkills: () => [], cloudOrgSkillsStatus: () => null, importedCloudSkills: () => ({}), hubRepo: () => null, hubRepos: () => [], ensureHubSkillsFresh: noop, ensureCloudOrgSkillsFresh: noop, refreshSkills: noop, refreshHubSkills: noop, refreshCloudOrgSkills: noop, setHubRepo: noop, addHubRepo: noop, removeHubRepo: noop, installSkillCreator: unavailable, installCloudOrgSkill: unavailable, installHubSkill: unavailable, importLocalSkill: noop, revealSkillsFolder: noop, readSkill: async () => ({ content: "# 技能" }), saveSkill: noop, uninstallSkill: noop,
};
function SourceCardsProof() {
  const cloud = useCloudSession();
  const [kind, setKind] = useState("plugins");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { cloud.setIsSignedIn(true); }, [cloud.setIsSignedIn]);
  return <main className="mx-auto min-h-screen max-w-5xl bg-background p-6 text-foreground">
    <h1 className="mb-3 text-lg font-semibold">插件与技能来源卡片验证</h1>
    <p className="mb-4 text-xs text-muted-foreground">生产页面与客户端 · 隔离目录响应 · 不执行安装</p>
    <div className="mb-6 flex gap-2"><Button data-testid="proof-plugins" onClick={() => setKind("plugins")}>插件</Button><Button data-testid="proof-skills" onClick={() => setKind("skills")}>技能</Button><Button data-testid="proof-theme" variant="outline" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>切换主题</Button></div>
    {kind === "plugins" ? <PluginPackagesPanel client={baseClient} workspaceId="cloud-proof" selectedPluginId={selected} onSelectPlugin={setSelected} onOpenUrl={noop} mcpStatuses={{}} onConnectMcp={async () => null} onLogoutMcpAuth={noop} onRelationshipsChange={noop} marketplaceView={(search, filters, installed, catalog) => <CloudMarketplacesView client={baseClient} workspaceId="cloud-proof" embedded search={search} categoryFilter={filters.category} statusFilter={filters.status} installedPackages={installed} catalog={catalog} onOpenAccount={noop} onOpenInstalled={setSelected} />} /> : <SkillsView client={baseClient} workspaceId="cloud-proof" workspaceName="样式验证" busy={false} canInstallSkillCreator canUseDesktopTools extensions={skillExtensions} onOpenLink={noop} createSessionAndOpen={noop} />}
    <Toaster />
  </main>;
}
createRoot(document.getElementById("root")!).render(sourceProof ? <HashRouter><CloudSessionProvider><SourceCardsProof /></CloudSessionProvider></HashRouter> : new URLSearchParams(location.search).has("layout") ? <LayoutProof /> : <HashRouter><CloudSessionProvider><Proof /></CloudSessionProvider></HashRouter>);
