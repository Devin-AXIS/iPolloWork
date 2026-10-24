import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkCenter } from "../src/react-app/domains/work/work-center";
import { EnvironmentView } from "../src/react-app/domains/settings/pages/environment-view";
import { SidebarProvider } from "../src/components/ui/sidebar";
import type { WorkItem } from "@ipollowork/types/work-items";
import { createRoot } from "react-dom/client";
import { DEFAULT_WORK_BOARD_CONFIG } from "@ipollowork/types/work-items";
import { Button } from "../src/components/ui/button";
import { SettingsListSearchInput } from "../src/react-app/domains/settings/settings-list";
import { PluginPackagesPanel } from "../src/react-app/domains/settings/plugin-packages-panel";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { HashRouter } from "react-router-dom";
import { WorkItemSheet, type WorkItemEditorValue } from "../src/react-app/domains/work/work-item-sheet";
import { setLocale } from "../src/i18n";
import "../src/app/index.css";

setLocale("zh");
const listProof = new URLSearchParams(location.search).has("lists");
const workItems: WorkItem[] = Array.from({ length: 24 }, (_, index) => ({
  id: "task-" + index, workspaceId: "proof", title: index === 23 ? "自动任务（保留原控制）" : "任务 " + String(23 - index).padStart(2, "0"),
  description: null, status: index % 2 ? "done" : "planned", assignee: null, priority: "normal",
  startAt: null, dueAt: null, automation: index === 23 ? { enabled: true, recurrence: "once" } : null,
  automationLastRunAt: null, automationLastSessionId: null, automationLastError: null, position: index,
  customFields: {}, execution: null, lastError: null, runStartedAt: null, runCompletedAt: null,
  version: 1, createdAt: 1791780000000, updatedAt: 1791780000000 + index * 1000,
}));
let envItems = Array.from({ length: 23 }, (_, index) => ({ key: "PROOF_" + String(23 - index).padStart(2, "0"), hasValue: true, updatedAt: 1791780000000 }));
const writes: { path: string; body: unknown }[] = [];
let failWork = true, failEnv = true, failRead = false;
Reflect.set(window, "listProof", { writes, setFailures: (work: boolean, env: boolean, read: boolean) => { failWork = work; failEnv = env; failRead = read; } });
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("https://controls-proof.invalid/")) return originalFetch(input, init);
  if (!listProof) return Response.json({ items: [] });
  const path = new URL(url).pathname;
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  if (init?.method === "PATCH") {
    writes.push({ path, body });
    await new Promise(resolve => setTimeout(resolve, 150));
    const item = workItems.find(item => path.endsWith("/" + item.id));
    if (!item || (failWork && item.id === "task-0")) return Response.json({ message: "模拟版本冲突，请刷新后重试" }, { status: 409 });
    if (body.expectedVersion !== item.version) return Response.json({ message: "版本冲突" }, { status: 409 });
    item.status = body.status; item.version++; item.updatedAt++;
    return Response.json(item);
  }
  if (init?.method === "DELETE") {
    writes.push({ path, body });
    await new Promise(resolve => setTimeout(resolve, 150));
    if (failEnv && path.endsWith("/PROOF_23")) return Response.json({ message: "模拟删除失败，请重试" }, { status: 500 });
    envItems = envItems.filter(item => !path.endsWith("/" + item.key));
    return Response.json({ ok: true });
  }
  if (path === "/env/status") return Response.json({ pendingChanges: writes.some(write => write.path.startsWith("/env/")) });
  if (path === "/env") return failRead ? Response.json({ message: "模拟读取失败" }, { status: 500 }) : Response.json({ items: envItems });
  if (path.startsWith("/env/")) return Response.json({ item: { ...envItems.find(item => path.endsWith("/" + item.key)), value: "isolated-test-value" } });
  if (path === "/work-items") return failRead ? Response.json({ message: "模拟读取失败" }, { status: 500 }) : Response.json({ items: workItems, nextCursor: null });
  if (path.endsWith("/work-board")) return Response.json(DEFAULT_WORK_BOARD_CONFIG);
  if (path.endsWith("/config")) return Response.json({ opencode: {}, ipollowork: {} });
  return Response.json({ items: [] });
};
const client = createiPolloWorkServerClient({baseUrl: "https://controls-proof.invalid"});
const schedule = { startAt: new Date(2026, 9, 12, 9, 30).getTime(), dueAt: new Date(2026, 9, 12, 10, 30).getTime() };
function Proof() {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [saved, setSaved] = React.useState<WorkItemEditorValue | null>(null);
  return <main className="mx-auto max-w-lg space-y-4 p-6">
    <h1>共享控件真实业务入口</h1>
    <p>真实组件，保存使用隔离回调，不创建日常任务。</p>
    <SettingsListSearchInput value={query} onValueChange={setQuery} aria-label="搜索插件" />
    <output id="host-search-results">{["图片插件", "视频插件"].filter(value => value.includes(query)).join("、") || "暂无结果"}</output>
    <Button id="open-work-sheet" onClick={() => setOpen(true)}>创建计划任务</Button>
    <output id="work-save-receipt">{JSON.stringify(saved)}</output>
    <section id="plugin-library-proof">
      <PluginPackagesPanel client={client} workspaceId="proof" selectedPluginId={null}
        onSelectPlugin={() => undefined} onOpenUrl={() => undefined} mcpStatuses={{}}
        onConnectMcp={async () => null} onLogoutMcpAuth={() => undefined} onRelationshipsChange={() => undefined}
        marketplaceView={(search, filters) => <output id="plugin-library-filter-receipt">{JSON.stringify({search, ...filters})}</output>} />
    </section>
    <WorkItemSheet open={open} item={null} board={DEFAULT_WORK_BOARD_CONFIG} defaultStatus="todo" scheduleMode initialSchedule={schedule} saving={false} deleting={false} agents={[]} providers={[]} connectedProviderIds={[]} onOpenChange={setOpen} onSave={value => { setSaved(value); setOpen(false); }} />
  </main>;
}
const proofQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function ListsProof() {
  const [tab, setTab] = React.useState("work");
  const workspace = { id: "proof", name: "隔离验证项目", path: "/isolated/proof", preset: "", workspaceType: "local" };
  return <QueryClientProvider client={proofQueryClient}><HashRouter><SidebarProvider>
    <div className="h-screen w-full overflow-auto p-4">
      <p className="text-ui-meta">真实客户端组件 + HTTP 客户端；仅模拟服务响应，不修改日常任务或密钥。</p>
      <div className="flex gap-2 py-2"><Button id="proof-work" onClick={() => setTab("work")}>项目任务</Button><Button id="proof-env" onClick={() => setTab("env")}>环境变量</Button></div>
      {tab === "work" ? <div className="h-[760px]"><WorkCenter mode="project" selectedWorkspaceId="proof" runtimeWorkspaceId="proof" selectedClient={client} environmentClient={client} workspaces={[{ ...workspace, workspaceType: "local" }]} providers={[]} connectedProviderIds={[]} onOpenSession={() => undefined} /></div>
        : <section id="environment-list" className="max-w-4xl"><EnvironmentView client={client} isRemoteWorkspace={false} runtimeKey="proof" onApplyChanges={async () => undefined} /></section>}
    </div>
  </SidebarProvider></HashRouter></QueryClientProvider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing proof root");
createRoot(root).render(listProof ? <ListsProof /> : <HashRouter><Proof /></HashRouter>);
