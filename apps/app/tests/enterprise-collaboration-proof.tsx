import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "../src/app/index.css";
import { enterpriseFeaturesSchema, type EnterpriseAccess, type EnterpriseMessage, type EnterpriseSnapshot, type EnterpriseSubmission } from "@ipollowork/types/enterprise";
import { joinEnterpriseWithCode, readEnterpriseConnections, saveEnterpriseConnection, setEnterpriseConnectionAccount, type EnterpriseConnection } from "../src/app/lib/enterprise-connections";
import { readDenSettings, writeDenSettings } from "../src/app/lib/den";
import { activateEnterpriseWorkContext, activatePersonalWorkContext, clearEnterpriseLoginState, type WorkContextId } from "../src/app/lib/work-context";
import { createiPolloWorkServerClient, type iPolloWorkSession } from "../src/app/lib/ipollowork-server";
import { userVisibleSessionsByWorkspaceId, type RouteSession } from "../src/react-app/shell/route-workspaces";
import { readSessionDirectoryCache, writeSessionDirectoryCache } from "../src/react-app/shell/session-memory";
import { requestEnterpriseSessionShare } from "../src/app/lib/enterprise-client";
import { EnterpriseResourceControls, EnterpriseSessionSharing, EnterpriseSnapshotNotice, EnterpriseMessageList, WorkResourceScopeSwitch, useActiveEnterpriseConnection, useEnterpriseMessages } from "../src/react-app/domains/enterprise";
import { TemplateMarketDialog, type TemplateCatalogSource } from "../src/react-app/domains/session/templates/template-market-dialog";
import { Button } from "../src/components/ui/button";
import { Toaster } from "../src/components/ui/sonner";
import { DenAuthProvider, useDenAuth } from "../src/react-app/domains/cloud/den-auth-provider";
import { CloudSessionProvider } from "../src/react-app/domains/settings/cloud/cloud-session-provider";
import { CloudAccountSection } from "../src/react-app/domains/settings/cloud/cloud-account-section";
import { useDenSession } from "../src/react-app/domains/settings/cloud/use-den-session";
import { NotificationBell } from "../src/react-app/shell/notification-center";
import { ShellConfigProvider } from "../src/react-app/shell/shell-config";
import { ReloadCoordinatorProvider } from "../src/react-app/shell/reload-coordinator";
import { useNotificationStore } from "../src/react-app/kernel/notification-store";
import { setLocale } from "../src/i18n";

// Only the isolated fixture URL uses this synthetic transport. Production imports never load it.
const initial: EnterpriseConnection = { id: "ent_proof", name: "星河科技", shortName: "星河", origin: "https://enterprise-proof.invalid", logoUrl: null, accent: "blue", authMode: "ipollo_oidc", membership: { id: "employee-1", role: "owner", status: "active", departmentId: "product" }, session: { token: "synthetic-proof-session", expiresAt: "2099-01-01T00:00:00.000Z" }, features: enterpriseFeaturesSchema.parse({ membership: true, directory: true, messaging: true, sessionSharing: true, resourceManagement: true, resourcePermissions: true, templatePublishing: true, extensionPublishing: true, skills: true, skillPublishing: true }) };
const departments = [{ id: "company", name: "星河科技", parentId: null }, { id: "product", name: "产品部", parentId: "company" }, { id: "engineering", name: "研发部", parentId: "company" }, { id: "empty", name: "空部门", parentId: "company" }];
const roleNames = { owner: "企业超管", admin: "管理员", template_admin: "模板管理员", extension_admin: "插件管理员", skill_admin: "技能管理员", member: "员工" };
const members = [{ id: "zhang", displayName: "张敏", email: "zhangmin@example.com", departmentId: "product", role: "member", status: "active" }, { id: "li", displayName: "李晨", email: "lichen@example.com", departmentId: "product", role: "member", status: "active" }, { id: "wang", displayName: "王磊", email: "wanglei@example.com", departmentId: "engineering", role: "member", status: "active" }];
const summary = "## 任务背景\n梳理产品页面和交互需求。\n\n## 关键结论\n沿用已经确认的信息结构。\n\n## 下一步\n细化原型和验收条件。";
const message: EnterpriseMessage = { id: "received-share", title: "产品方案讨论总结", kind: "session_share", senderName: "张敏", createdAt: "2026-10-16T02:00:00.000Z", readAt: null, acceptedAt: null, ignoredAt: null, revokedAt: null, markdown: summary, resourceType: null };
let access: EnterpriseAccess = { revision: 0, access: "restricted", memberIds: [], departments: [], groupIds: ["existing-group"] };
let imported: EnterpriseSnapshot | null = null;
let summaryCalls = 0;
let shareCount = 0;
let creates = 0;
let uploads = 0;
const submissions: Record<"template" | "extension" | "skill", EnterpriseSubmission[]> = { template: [], extension: [], skill: [] };
let serviceRole: EnterpriseConnection["membership"]["role"] | null = null;
let managementRequests = 0;
let managementWrites = 0;
let grants = 0;
let recipients = 0;
let failNextShare = false;
let failNextSummary = false;
let failNextImport = false;
let failNextAccept = false;
let acceptCalls = 0;
const shareKeys = new Set<string>();
const importedSession = () => ({ id: "imported-session", title: message.title, time: { created: 1000, updated: 1000 }, enterpriseShare: true });
const baseFetch = window.fetch.bind(window);
const accountCacheMode = new URLSearchParams(window.location.search).has("account-cache");
const notificationsMode = new URLSearchParams(window.location.search).has("notifications");
const notificationMessages: EnterpriseMessage[] = [
  { ...message, id: "permission-message", title: "专注脉冲 · 使用权限已更新", kind: "resource_granted", markdown: null, resourceType: "extension" },
  { ...message, id: "review-message", title: "Web Prototype · 审核通过", kind: "submission_reviewed", markdown: null },
];
const initialNotificationMessages = [...notificationMessages];
let notificationRequests = 0;
const proofCloudUrl = "https://account-proof.invalid";
let accountLoginCount = 0;
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!url.hostname.endsWith("-proof.invalid")) return baseFetch(input, init);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  if (notificationsMode && url.pathname.endsWith("/messages")) {
    notificationRequests++;
    const items = new Headers(init?.headers).get("authorization")?.includes("employee-2")
      ? [{ ...message, id: "other-member-message", title: "另一成员的通知" }] : notificationMessages;
    return Response.json({ items, nextCursor: "older-notification-page" });
  }
  if (url.hostname === "account-proof.invalid") {
    const account = String(body.grant ?? new Headers(init?.headers).get("authorization")).includes("account-b") ? "b" : "a";
    const user = { id: `account-${account}`, name: `验证账号 ${account.toUpperCase()}`, email: `account-${account}@example.test` };
    if (url.pathname.endsWith("/desktop-handoff/exchange")) return Response.json({ user, token: `synthetic-cloud-account-${account}-${++accountLoginCount}` });
    if (url.pathname.endsWith("/v1/me")) return Response.json({ user });
    if (url.pathname.endsWith("/orgs")) return Response.json({ orgs: [] });
    if (url.pathname.endsWith("/api/auth/token")) return Response.json({ token: "synthetic-identity" });
    if (url.pathname.endsWith("/sign-out")) return Response.json({ ok: true });
  }
  if (url.pathname.endsWith("/join")) return Response.json({ enterprise: initial, membership: initial.membership, session: initial.session });
  if (url.pathname.endsWith("/client-manifest")) return Response.json({ enterprise: initial, features: initial.features });
  if (url.pathname.includes(".well-known")) return Response.json({ serverId: initial.id, name: initial.name, origin: initial.origin, authMode: initial.authMode });
  if (url.pathname.endsWith("/membership")) {
    const membership = (readEnterpriseConnections().find((item) => item.id === initial.id) ?? initial).membership;
    return Response.json({ membership: { ...membership, role: serviceRole ?? membership.role, displayName: "验证用户", email: "owner@example.com" } });
  }
  if ((url.pathname.endsWith("/resources") && url.searchParams.get("view") === "manage") || url.pathname.endsWith("/access") || url.pathname.endsWith("/review") || method === "PATCH") {
    managementRequests++;
    if (method !== "GET") managementWrites++;
    if (serviceRole === "member") return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (url.pathname.endsWith("/departments")) return Response.json({ items: departments, nextCursor: null });
  if (url.pathname.endsWith("/members")) {
    const search = url.searchParams.get("search")?.toLowerCase();
    const departmentId = url.searchParams.get("departmentId");
    const result = members.filter((member) => search ? `${member.displayName} ${member.email}`.toLowerCase().includes(search) : departmentId === "company" && url.searchParams.get("includeDescendants") === "true" ? true : member.departmentId === departmentId);
    const more = url.searchParams.has("cursor");
    return Response.json({ items: more ? result.slice(1) : result.slice(0, 1), nextCursor: result.length > 1 && !more ? "member-page-2" : null });
  }
  if (url.pathname.endsWith("/session-shares")) {
    if (failNextShare) { failNextShare = false; return Response.json({ error: "temporary_unavailable" }, { status: 503 }); }
    if (!shareKeys.has(body.idempotencyKey)) { shareKeys.add(body.idempotencyKey); shareCount++; recipients = body.recipientIds.length; }
    return Response.json({ id: "outgoing-share" });
  }
  if (url.pathname.endsWith("/share-summary")) {
    if (failNextSummary) { failNextSummary = false; return Response.json({ code: "provider_quota_exhausted", message: "第三方服务余额或额度不足，请检查余额、用量限制或等待额度恢复。" }, { status: 402 }); }
    summaryCalls++; return Response.json({ item: { title: "产品方案讨论总结", markdown: summary, messageCount: 6, truncated: false } });
  }
  if (url.pathname.endsWith("/enterprise-shares/import")) {
    if (failNextImport) { failNextImport = false; return Response.json({ code: "internal_error", message: "Synthetic local persistence failure" }, { status: 500 }); }
    if (!imported && !body.snapshot.markdown) return Response.json({ code: "enterprise_share_not_imported", message: "No local copy" }, { status: 404 });
    if (!imported) { imported = body.snapshot; creates++; }
    return Response.json({ item: importedSession(), workspaceId: "project-proof" });
  }
  if (url.pathname.endsWith("/sessions")) return Response.json({ items: imported ? [importedSession()] : [] });
  if (url.pathname.endsWith("/enterprise-share")) return Response.json({ snapshot: imported });
  if (url.pathname.endsWith("/messages")) return Response.json({ items: [message], nextCursor: null });
  if (url.pathname.endsWith(`/messages/${message.id}`)) { await new Promise((resolve) => window.setTimeout(resolve, 100)); return Response.json(message); }
  if (url.pathname.endsWith("/read")) { message.readAt = new Date().toISOString(); return Response.json({ ok: true }); }
  if (url.pathname.endsWith("/accept")) {
    acceptCalls++;
    if (failNextAccept) { failNextAccept = false; return Response.json({ error: "temporary_unavailable" }, { status: 503 }); }
    message.acceptedAt = new Date().toISOString(); message.markdown = null; return Response.json({ ok: true });
  }
  if (url.pathname.endsWith("/ignore")) { message.ignoredAt = new Date().toISOString(); message.markdown = null; return Response.json({ ok: true }); }
  if (url.pathname.endsWith("/access")) { if (method === "PUT") { access = { ...body, revision: access.revision + 1 }; grants++; } return Response.json(access); }
  if (url.pathname.endsWith("-submissions")) {
    const type = url.pathname.endsWith("/template-submissions") ? "template" : url.pathname.endsWith("/skill-submissions") ? "skill" : "extension";
    if (method === "POST") { uploads++; const item: EnterpriseSubmission = { resourceId: `${type}-submission-${uploads}`, resourceName: type === "template" ? "我的企业模板" : type === "skill" ? "我的企业技能" : "我的企业插件", version: "1.0.0", reviewStatus: "pending", reviewNote: null }; submissions[type].push(item); return Response.json(item); }
    return Response.json({ items: submissions[type] });
  }
  if (url.pathname.endsWith("/resources")) {
    const type = url.searchParams.get("type") ?? "template";
    return Response.json({ items: [{ id: `${type}-1`, type, name: type === "template" ? "产品提案模板" : type === "skill" ? "笔记整理技能" : "产品调研助手", status: "published", access: "restricted", ownerName: "张敏", latestVersion: { version: "1.2.0", reviewStatus: "approved" } }, { id: `${type}-2`, type, name: type === "template" ? "待审核报告模板" : type === "skill" ? "待审核整理技能" : "待审核调研插件", status: "draft", access: "admins", ownerName: "王磊", latestVersion: { version: "1.0.0", reviewStatus: "pending" } }], nextCursor: null });
  }
  if (url.pathname.endsWith("/review") || method === "PATCH") return Response.json({ ok: true });
  return Response.json({ error: "not_found" }, { status: 404 });
};
if (accountCacheMode) {
  const stored = readDenSettings();
  writeDenSettings({ baseUrl: proofCloudUrl, authToken: stored.baseUrl === proofCloudUrl ? stored.authToken : null });
} else {
  writeDenSettings({ baseUrl: proofCloudUrl, authToken: "synthetic-cloud-account-a" });
  setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: proofCloudUrl, token: "synthetic-cloud-account-a" });
  saveEnterpriseConnection(initial);
  localStorage.setItem("ipollowork.work-context.v1", "enterprise:ent_proof");
}
localStorage.setItem("ipollowork.language", "zh");
const client = createiPolloWorkServerClient({ baseUrl: "https://local-proof.invalid", token: "synthetic-local-token" });

function restoreProofOwner() {
  serviceRole = null;
  writeDenSettings({ baseUrl: proofCloudUrl, authToken: "synthetic-cloud-account-a" });
  setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: proofCloudUrl, token: "synthetic-cloud-account-a" });
  saveEnterpriseConnection(initial);
  void activateEnterpriseWorkContext(initial);
}

function AccountCacheProof() {
  const auth = useDenAuth();
  const session = useDenSession({ developerMode: true, openLink: () => {} });
  const [error, setError] = useState("");
  const bindEnterprise = async () => {
    try {
      const settings = readDenSettings();
      await joinEnterpriseWithCode({ cloudBaseUrl: settings.baseUrl, cloudToken: settings.authToken ?? "", enterpriseBaseUrl: initial.origin, joinCode: "ABCDE-23456" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <main className="min-h-screen bg-background p-8 text-foreground"><div className="mx-auto max-w-3xl space-y-5">
    <h1 className="text-xl font-semibold">企业绑定缓存验证</h1><p className="text-sm text-muted-foreground">隔离合成账号 · 复用生产登录、退出、企业绑定和账号设置控件</p>
    <p data-testid="proof-account-status">{auth.status === "signed_in" ? auth.user?.name : auth.status === "signed_out" ? "当前未登录" : "正在验证账号"}</p>
    <div className="flex gap-2"><Button data-testid="proof-login-account-a" onClick={() => void session.onSubmitManualAuth(`ipollowork://den-auth?grant=proof-account-a&denBaseUrl=${encodeURIComponent(proofCloudUrl)}`)}>登录账号 A</Button><Button data-testid="proof-login-account-b" onClick={() => void session.onSubmitManualAuth(`ipollowork://den-auth?grant=proof-account-b&denBaseUrl=${encodeURIComponent(proofCloudUrl)}`)}>登录账号 B</Button><Button data-testid="proof-bind-account" disabled={!auth.isSignedIn} onClick={() => void bindEnterprise()}>绑定验证企业</Button></div>
    {error || session.authError ? <p role="alert">{error || session.authError}</p> : null}
    <section className="rounded-2xl border bg-background p-6"><CloudAccountSection authBusy={session.authBusy} sessionBusy={session.sessionBusy} statusLabel={session.summaryLabel} statusTone={session.summaryTone} onSignOut={session.onSignOut} onSignInRequired={() => {}} /></section><Toaster />
  </div></main>;
}

function NotificationProof() {
  const [revision, setRevision] = useState(0);
  const reset = () => {
    notificationMessages.splice(0, notificationMessages.length, ...initialNotificationMessages);
    useNotificationStore.setState({ notifications: [], clearedSources: {} });
    useNotificationStore.getState().add({ kind: "cloud", title: "公开插件更新可用", body: "新版本已发布。" });
    restoreProofOwner();
    window.dispatchEvent(new Event("focus"));
    setRevision((value) => value + 1);
  };
  return <ShellConfigProvider><ReloadCoordinatorProvider><main className="min-h-screen bg-background p-6 text-foreground">
    <style>{'[data-slot="popover-content"]{animation:none!important;transition:none!important}'}</style>
    <h1 className="text-xl font-semibold">统一通知清除验证</h1>
    <p className="mt-2 text-sm text-muted-foreground">生产通知中心 · 隔离消息响应 · 清除记录在本机保存</p>
    <div className="my-6 flex flex-wrap items-center gap-3">
      <Button data-testid="notification-proof-reset" onClick={reset}>重置通知</Button>
      <Button data-testid="notification-proof-new" onClick={() => { notificationMessages.unshift({ ...message, id: `new-${Date.now()}`, title: "清除后新收到的通知", createdAt: new Date().toISOString() }); window.dispatchEvent(new Event("focus")); }}>收到新通知</Button>
      <Button data-testid="notification-proof-member" onClick={() => { saveEnterpriseConnection({ ...initial, membership: { ...initial.membership, id: "employee-2" }, session: { ...initial.session, token: "synthetic-employee-2" } }); }}>切换另一成员</Button>
      <Button data-testid="notification-proof-reopen" onClick={async () => { await useNotificationStore.persist.rehydrate(); setRevision((value) => value + 1); }}>重开通知中心</Button>
      <Button data-testid="notification-proof-theme" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>切换主题</Button>
      <NotificationBell key={revision} />
    </div>
    <p key={revision} className="text-xs text-muted-foreground">通知请求 {notificationRequests}</p>
  </main></ReloadCoordinatorProvider></ShellConfigProvider>;
}

function Proof() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isSessionRoute = pathname.includes("/session");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  useEffect(() => {
    if (!isSessionRoute) { setWorkspaceReady(false); return; }
    const timer = window.setTimeout(() => setWorkspaceReady(true), 250);
    return () => window.clearTimeout(timer);
  }, [isSessionRoute]);
  const connection = useActiveEnterpriseConnection();
  const [sourceName, setSourceName] = useState(initial.name);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [templateSource, setTemplateSource] = useState<TemplateCatalogSource>("enterprise");
  const [resourceScope, setResourceScope] = useState<WorkContextId>("enterprise:ent_proof");
  const sourceConnection = connection ? { ...connection, name: sourceName } : null;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<RouteSession[]>([]);
  const rememberSessions = (items: Array<RouteSession | iPolloWorkSession>) => {
    setSessions(items);
    writeSessionDirectoryCache({ "project-proof": items });
  };
  const visibleSessions = userVisibleSessionsByWorkspaceId({ "project-proof": sessions })["project-proof"];
  const [revision, setRevision] = useState(0);
  const inbox = useEnterpriseMessages(connection);
  return <main className="min-h-screen bg-background p-6 text-foreground"><div className="mx-auto max-w-5xl space-y-5">
    <div><h1 className="text-xl font-semibold">企业协作功能验证</h1><p className="mt-2 text-sm text-muted-foreground">隔离界面验证 · 企业和模型返回使用合成数据 · 生产控件直接复用</p></div>
    <p data-testid="proof-route" className="text-xs text-muted-foreground">当前路由 {pathname} · 本机项目 {workspaceReady ? "已就绪" : "连接中"}</p>
    {sourceConnection ? <section className="space-y-2 rounded-xl border p-3"><p className="text-xs text-muted-foreground">模板与插件来源名称验证</p><div data-testid="proof-plugin-source" className="max-w-[360px]"><WorkResourceScopeSwitch enterprise={sourceConnection} value={resourceScope} onChange={setResourceScope} /></div><div className="flex gap-2"><Button variant="outline" data-testid="proof-template-source" onClick={() => setSourceDialogOpen(true)}>查看模板来源</Button><Button variant="outline" data-testid="proof-long-source-name" onClick={() => setSourceName("星河科技企业协作与数字创意研发中心企业资源管理服务平台")}>切换长企业名</Button></div></section> : null}
    {sourceDialogOpen && sourceConnection ? <TemplateMarketDialog open onOpenChange={setSourceDialogOpen} templates={[]} remoteResources={[]} loading={false} error={null} busyId={null} getCover={async () => ({ data: new ArrayBuffer(0) })} cloudAvailable enterpriseAvailable enterpriseConnection={sourceConnection} source={templateSource} onSelectSource={setTemplateSource} onRefresh={() => {}} onUse={() => {}} onCustom={() => {}} onInstall={() => {}} onImport={async () => true} onInstallRemote={() => {}} /> : null}
    {connection ? <><section className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4"><span className="mr-auto text-sm font-medium">{connection.name} · {roleNames[connection.membership.role]}</span><Button data-testid="proof-share" disabled={!connection.features?.sessionSharing} onClick={() => requestEnterpriseSessionShare("project-proof", "source-session")}>分享产品讨论</Button><EnterpriseResourceControls connection={connection} type="template" /><EnterpriseResourceControls connection={connection} type="extension" /><EnterpriseResourceControls connection={connection} type="skill" /></section>
    <div className="grid gap-5 md:grid-cols-[360px_minmax(0,1fr)]"><section className="overflow-hidden rounded-xl border border-border"><EnterpriseMessageList key={`${connection.id}:${connection.membership.id}`} connection={connection} inbox={inbox} onExit={() => setRevision((value) => value + 1)} /></section><section className="rounded-xl border border-border p-4"><h2 className="mb-3 text-sm font-semibold">接收后的会话</h2>{sessionId ? <><p className="text-sm">产品方案讨论 · 独立会话</p><EnterpriseSnapshotNotice key={revision} connection={connection} client={client} workspaceId="project-proof" sessionId={sessionId} /><p className="mt-3 text-xs text-muted-foreground">等待用户继续提问，未启动模型执行。</p></> : <p className="py-12 text-center text-sm text-muted-foreground">接收分享后在此打开独立会话</p>}</section></div></> : <p data-testid="proof-personal" className="rounded-xl border p-5">当前为个人模式或企业登录已失效 · 企业协作入口已隐藏</p>}
    <section className="flex flex-wrap gap-2"><Button variant="outline" data-testid="proof-fail-summary" onClick={() => { failNextSummary = true; }}>模拟下一次总结失败</Button><Button variant="outline" data-testid="proof-fail-send" onClick={() => { failNextShare = true; }}>模拟下一次发送失败</Button><Button variant="outline" data-testid="proof-member" onClick={() => { const next = { ...initial, membership: { ...initial.membership, role: "member" } } satisfies EnterpriseConnection; saveEnterpriseConnection(next); }}>切换员工</Button><Button variant="outline" data-testid="proof-legacy" onClick={() => { const next = { ...initial, features: enterpriseFeaturesSchema.parse({}) }; saveEnterpriseConnection(next); }}>旧企业服务</Button><Button variant="outline" data-testid="proof-owner" onClick={restoreProofOwner}>恢复超管</Button><Button variant="outline" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>切换深色</Button><Button variant="outline" data-testid="proof-stats" onClick={() => setRevision((value) => value + 1)}>刷新验证记录</Button></section>
    <section className="flex flex-wrap gap-2"><Button variant="outline" data-testid="proof-personal-mode" onClick={() => { void activatePersonalWorkContext(); }}>切换个人</Button><Button variant="outline" data-testid="proof-expire" onClick={() => saveEnterpriseConnection({ ...initial, session: { ...initial.session, expiresAt: new Date(Date.now() + 5000).toISOString() } })}>登录将在 5 秒后过期</Button><Button variant="outline" data-testid="proof-suspend" onClick={() => saveEnterpriseConnection({ ...initial, membership: { ...initial.membership, status: "suspended" } })}>停用成员</Button><Button variant="outline" data-testid="proof-sign-out" onClick={clearEnterpriseLoginState}>退出登录</Button></section>
    <section className="flex flex-wrap gap-2">{(["admin", "template_admin", "extension_admin", "skill_admin"] as const).map(role => <Button key={role} variant="outline" data-testid={`proof-${role}`} onClick={() => saveEnterpriseConnection({ ...initial, membership: { ...initial.membership, role } })}>切换{roleNames[role]}</Button>)}</section>
    <section className="flex flex-wrap gap-2"><Button variant="outline" data-testid="proof-fail-import" onClick={() => { failNextImport = true; }}>模拟本机保存失败</Button><Button variant="outline" data-testid="proof-fail-accept" onClick={() => { failNextAccept = true; }}>模拟接收回执失败</Button></section>
    <section data-testid="proof-session-history" className="rounded-xl border p-4"><h2 className="text-sm font-semibold">会话记录（生产列表过滤）</h2>{visibleSessions.map((session) => <p key={session.id} data-testid="proof-session-row" className="mt-2 text-sm">{session.title}</p>)}<div className="mt-3 flex gap-2"><Button variant="outline" data-testid="proof-refresh-sessions" onClick={() => { void client.listSessions("project-proof").then(({ items }) => rememberSessions(items)); }}>从本机服务刷新列表</Button><Button variant="outline" data-testid="proof-restore-cache" onClick={() => setSessions(readSessionDirectoryCache()["project-proof"] ?? [])}>从启动缓存恢复列表</Button></div></section>
    <section className="flex gap-2"><Button variant="outline" data-testid="proof-settings" onClick={() => navigate("/settings/extensions")}>进入设置页</Button><Button variant="outline" data-testid="proof-workspace-route" onClick={() => navigate("/workspace/project-proof/session")}>进入企业会话页</Button></section>
    <Button variant="outline" data-testid="proof-reset-received" onClick={() => { imported = null; creates = 0; acceptCalls = 0; message.markdown = summary; message.acceptedAt = null; message.readAt = null; setSessionId(null); rememberSessions([]); setRevision((value) => value + 1); inbox.refresh(); }}>重置隔离分享数据</Button>
    <Button variant="outline" data-testid="proof-demote-member" onClick={() => { serviceRole = "member"; }}>后台降为成员</Button>
    <p data-testid="proof-result" data-management-requests={managementRequests} data-management-writes={managementWrites} className="text-xs text-muted-foreground">总结生成次数 {summaryCalls} · 分享次数 {shareCount} · 分享对象 {recipients} 人 · 本机创建次数 {creates} · 投稿次数 {uploads} · 权限保存次数 {grants} · 企业登录记录 {readEnterpriseConnections().length} · 企业正文 {message.markdown ? "待领取" : "已清理"} · 接收回执次数 {acceptCalls} · 管理请求 {managementRequests} · 管理写入 {managementWrites}</p>
    {connection && isSessionRoute ? <EnterpriseSessionSharing key={`${connection.id}:${connection.membership.id}`} connection={connection} currentWorkspaceId="project-proof" resolveWorkspace={() => workspaceReady ? ({ client, workspaceId: "project-proof" }) : null} model={{ providerID: "proof", modelID: "proof-model" }} engineId="opencode" onImported={(_workspaceId, id, session) => { setSessionId(id); rememberSessions([session]); setRevision((value) => value + 1); inbox.refresh(); navigate(`/workspace/project-proof/session/${id}`); }} /> : null}
    <Toaster />
  </div></main>;
}
if (notificationsMode) setLocale("zh");
createRoot(document.getElementById("root")!).render(<HashRouter>{notificationsMode ? <NotificationProof /> : accountCacheMode ? <DenAuthProvider><CloudSessionProvider><AccountCacheProof /></CloudSessionProvider></DenAuthProvider> : <Routes><Route path="/workspace/:workspaceId/session/:sessionId?" element={<Proof />} /><Route path="/session/:sessionId?" element={<Proof />} /><Route path="/settings/*" element={<Proof />} /><Route path="*" element={<Navigate to="/session" replace />} /></Routes>}</HashRouter>);
