import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultNavigationShortcuts, enterpriseNavigationSchema, type EnterpriseNavigation } from "@ipollowork/types/enterprise";
import { type EnterpriseConnection } from "../src/app/lib/enterprise-connections";
import { AppSidebar, type AppSidebarProps } from "../src/react-app/domains/session/sidebar/app-sidebar";
import { SidebarProvider } from "../src/components/ui/sidebar";
import { Button } from "../src/components/ui/button";
import { Toaster } from "../src/components/ui/sonner";
import { DenAuthProvider } from "../src/react-app/domains/cloud/den-auth-provider";
import { DesktopConfigProvider } from "../src/react-app/domains/cloud/desktop-config-provider";
import { ShellConfigProvider } from "../src/react-app/shell/shell-config";
import { ReloadCoordinatorProvider } from "../src/react-app/shell/reload-coordinator";
import { setLocale } from "../src/i18n";
import "../src/app/index.css";

// Isolated transport fixture: exercise the production sidebar and client, never production accounts.
setLocale("zh");
const client = new QueryClient();
const connection: EnterpriseConnection = { id: "ent_navigation", name: "导航验证企业", shortName: "导航验证", origin: "https://navigation-proof.invalid", authMode: "ipollo_oidc", logoUrl: null, accent: "blue", membership: { id: "owner", role: "owner", status: "active" }, session: { token: "synthetic-navigation-owner", expiresAt: "2099-01-01T00:00:00Z" }, features: { navigationShortcuts: true } };
let stored: EnterpriseNavigation = { revision: 0, items: defaultNavigationShortcuts };
let serviceRole = "owner";
let writes = 0;
const fetchBase = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== connection.origin) return fetchBase(input, init);
  const member = new Headers(init?.headers).get("authorization")?.includes("member") ? "member" : "owner";
  if (url.pathname.endsWith("/membership")) return Response.json({ membership: { id: member, role: member === "owner" ? serviceRole : "member", status: "active", displayName: member, email: member + "@example.test" } });
  if (url.pathname.endsWith("/navigation-shortcuts")) {
    if (init?.method === "PUT") {
      if (member !== "owner" || serviceRole !== "owner") return Response.json({ error: "forbidden" }, { status: 403 });
      const parsed = enterpriseNavigationSchema.parse(JSON.parse(String(init.body)));
      if (parsed.revision !== stored.revision) return Response.json({ error: "navigation_revision_conflict" }, { status: 409 });
      stored = { ...parsed, revision: parsed.revision + 1 }; writes++;
    }
    return Response.json(stored);
  }
  return Response.json({ error: "fixture_route_missing" }, { status: 404 });
};
const noop = () => {};
function Proof() {
  const [view, setView] = useState("");
  const [revision, setRevision] = useState(0);
  const base: AppSidebarProps = {
    projectSessionLists: [], selectedWorkspaceId: "", developerMode: false, selectedSessionId: null, connectingWorkspaceId: null, workspaceConnectionStateById: {}, newTaskDisabled: true,
    onOpenSession: noop, onSelectProject: noop, onOpenRenameProject: noop, onRevealProject: noop, onOpenDeleteProject: noop, onCreateTaskInWorkspace: noop,
    onRecoverWorkspace: noop, onTestWorkspaceConnection: noop, onEditWorkspaceConnection: noop,
    account: { loading: false, signedIn: true, name: "验证账号", email: null },
    onOpenAccount: noop, onOpenSettings: noop, onOpenHelp: noop, onSignIn: noop,
    onOpenTemplateMarket: () => setView("模板市场"), onOpenSchedule: () => setView("日程"), onOpenExtensions: () => setView("插件市场"),
    pluginShortcuts: [{ id: "plugin-workshop", pluginId: "plugin-workshop", label: "插件工坊", active: false, workshop: true, onClick: () => setView("插件工坊已打开") }],
  };
  return <QueryClientProvider client={client}><HashRouter><main className="min-h-screen bg-background p-6 text-foreground">
    <style>{'[data-slot="sidebar-container"]{position:relative!important;inset:auto!important;height:680px!important}[data-slot="sidebar-gap"]{display:none}'}</style>
    <h1 className="text-xl font-semibold">导航快捷入口验证</h1>
    <p className="my-3 text-sm text-muted-foreground">生产侧边栏与客户端 · 隔离企业服务 · 三个账号独立读取配置</p>
    <div className="mb-4 flex gap-2"><Button data-testid="proof-refresh" onClick={() => void client.invalidateQueries({ queryKey: ["enterprise-navigation"] })}>同步企业配置</Button><Button data-testid="proof-demote" onClick={() => { serviceRole = "member"; setRevision(value => value + 1); }}>后台降为成员</Button><Button data-testid="proof-stats" onClick={() => setRevision(value => value + 1)}>读取保存次数</Button></div>
    <p data-testid="proof-result" data-writes={writes} className="mb-4 text-sm" key={revision}>保存次数 {writes} · {view}</p>
    <div className="flex gap-6">{([null, connection, { ...connection, membership: { ...connection.membership, id: "member", role: "member" }, session: { ...connection.session, token: "synthetic-navigation-member" } }] satisfies (EnterpriseConnection | null)[]).map((current, index) =>
      <section key={index} data-testid={["proof-personal", "proof-admin", "proof-member"][index]} className="rounded-xl border"><h2 className="border-b p-3 text-sm font-medium">{["个人账号", "企业管理员", "普通成员（未安装插件）"][index]}</h2><SidebarProvider className="min-h-0 w-64"><AppSidebar {...base} workContextId={current ? "enterprise:ent_navigation" : "personal"} enterpriseConnection={current} pluginShortcuts={index === 2 ? [] : base.pluginShortcuts} /></SidebarProvider></section>
    )}</div><Toaster toastOptions={{ duration: 15_000 }} />
  </main></HashRouter></QueryClientProvider>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<DenAuthProvider><DesktopConfigProvider><ShellConfigProvider><ReloadCoordinatorProvider><Proof /></ReloadCoordinatorProvider></ShellConfigProvider></DesktopConfigProvider></DenAuthProvider>);
