import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../src/app/index.css";
import { SkillsView, type SkillsExtensionsStore } from "../src/react-app/domains/settings/pages/skills-view";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { removeEnterpriseConnection, saveEnterpriseConnection, setEnterpriseConnectionAccount, type EnterpriseConnection } from "../src/app/lib/enterprise-connections";
import { clearDenSession, readDenSettings, writeDenSettings } from "../src/app/lib/den";
import { Button } from "../src/components/ui/button";
import { Toaster } from "../src/components/ui/sonner";

if (!import.meta.env.DEV) throw new Error("Development proof only");
const api = new URLSearchParams(location.search).get("skills-api");
if (!api || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(api)) throw new Error("A localhost proof service is required");
const originalFetch = window.fetch.bind(window);
type Runtime = { hostUrl: string; workspaceId: string; token: string; enterpriseOrigin: string; connection: EnterpriseConnection };
const runtime: Runtime = await (await originalFetch(`${api}/runtime?actor=creator`)).json();
// Only this dev fixture forwards Enterprise requests, unchanged, through its localhost CORS proxy.
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return originalFetch(runtime.enterpriseOrigin !== api && url.startsWith(runtime.enterpriseOrigin + "/") ? `${api}/enterprise${url.slice(runtime.enterpriseOrigin.length)}` : input, init);
};
const client = createiPolloWorkServerClient({ baseUrl: runtime.hostUrl, token: runtime.token });
function activate(actor: string, connection: EnterpriseConnection) {
  writeDenSettings({ baseUrl: api!, authToken: `fixture-${actor}` });
  setEnterpriseConnectionAccount({ userId: actor, baseUrl: api!, token: `fixture-${actor}` });
  saveEnterpriseConnection(connection);
  localStorage.setItem("ipollowork.work-context.v1", `enterprise:${connection.id}`);
  window.dispatchEvent(new Event("ipollowork:work-context-changed"));
}
activate("creator", runtime.connection);
const removed = async () => ({ ok: false, message: "Repository fetching is not part of this skill page" });
const extensions: SkillsExtensionsStore = {
  skills: () => [], skillsStatus: () => null, hubSkills: () => [], hubSkillsStatus: () => null,
  cloudOrgSkills: () => [], cloudOrgSkillsStatus: () => null, importedCloudSkills: () => ({}),
  hubRepo: () => null, hubRepos: () => [], ensureHubSkillsFresh: () => undefined, ensureCloudOrgSkillsFresh: () => undefined,
  refreshSkills: async () => undefined, refreshHubSkills: () => undefined, refreshCloudOrgSkills: () => undefined,
  setHubRepo: () => undefined, addHubRepo: () => undefined, removeHubRepo: () => undefined,
  installSkillCreator: removed, installCloudOrgSkill: removed, installHubSkill: removed,
  importLocalSkill: () => undefined, revealSkillsFolder: () => undefined,
  readSkill: async (name) => client.getSkill(runtime.workspaceId, name),
  saveSkill: async (input) => { await client.upsertSkill(runtime.workspaceId, input); },
  uninstallSkill: async (name) => { await client.deleteSkill(runtime.workspaceId, name); },
};
function Proof() {
  const [actor, setActor] = useState("creator");
  const [cleaned, setCleaned] = useState(false);
  const cleanup = async () => {
    await client.setEnterpriseSkillContext(runtime.workspaceId, null);
    for (const id of ["creator", "manager", "employee"]) {
      writeDenSettings({ baseUrl: api!, authToken: `fixture-${id}` });
      setEnterpriseConnectionAccount({ userId: id, baseUrl: api!, token: `fixture-${id}` });
      removeEnterpriseConnection(runtime.connection.id);
    }
    setEnterpriseConnectionAccount(null);
    if (readDenSettings().authToken?.startsWith("fixture-")) clearDenSession({ includeBaseUrls: true });
    if (localStorage.getItem("ipollowork.work-context.v1") === `enterprise:${runtime.connection.id}`) localStorage.removeItem("ipollowork.work-context.v1");
    window.fetch = originalFetch;
    setCleaned(true);
  };
  if (cleaned) return <p className="p-6">临时联调账号缓存已清理。</p>;
  return <main className="min-h-screen bg-background p-6 text-foreground"><div className="mx-auto max-w-[1280px] space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"><div><h1 className="text-lg font-semibold">企业技能联调 · 隔离测试项目</h1><p className="mt-1 text-xs text-muted-foreground">{runtime.enterpriseOrigin === api ? "生产技能页面与隔离宿主接口；公开和企业目录使用本地测试服务，验证来源切换与权限上下文。" : "生产页面与本地宿主接口；企业请求直达本地真实企业后台。公开云端展示接口未部署状态。"}</p></div><div className="flex flex-wrap gap-2">{[["creator", "投稿员工"], ["manager", "技能管理员"], ["employee", "接收员工"]].map(([id, label]) => <Button key={id} size="sm" variant={actor === id ? "secondary" : "outline"} onClick={async () => { const data: Runtime = await (await originalFetch(`${api}/runtime?actor=${id}`)).json(); activate(id, data.connection); setActor(id); }}>{label}</Button>)}</div></div>
    <SkillsView key={actor} client={client} workspaceId={runtime.workspaceId} workspaceName="技能联调" busy={false} canInstallSkillCreator canUseDesktopTools extensions={extensions} onOpenLink={() => undefined} createSessionAndOpen={() => undefined} />
    <Button size="sm" variant="ghost" onClick={() => void cleanup()}>清理联调缓存</Button>
  </div><Toaster /></main>;
}
createRoot(document.getElementById("root")!).render(<HashRouter><Proof /></HashRouter>);
