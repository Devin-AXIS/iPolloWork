import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../src/app/index.css";
import { enterpriseFeaturesSchema, type EnterpriseAccess, type EnterpriseMessage, type EnterpriseSnapshot, type EnterpriseSubmission } from "@ipollowork/types/enterprise";
import { saveEnterpriseConnection, type EnterpriseConnection } from "../src/app/lib/enterprise-connections";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { requestEnterpriseSessionShare } from "../src/app/lib/enterprise-client";
import { EnterpriseResourceControls, EnterpriseSessionSharing, EnterpriseSnapshotNotice, EnterpriseMessageList, useEnterpriseMessages } from "../src/react-app/domains/enterprise";
import { Button } from "../src/components/ui/button";
import { Toaster } from "../src/components/ui/sonner";

// Only the isolated fixture URL uses this synthetic transport. Production imports never load it.
const initial: EnterpriseConnection = { id: "ent_proof", name: "星河科技", shortName: "星河", origin: "https://enterprise-proof.invalid", logoUrl: null, accent: "blue", authMode: "ipollo_oidc", membership: { id: "employee-1", role: "owner", status: "active", departmentId: "product" }, session: { token: "synthetic-proof-session", expiresAt: "2099-01-01T00:00:00.000Z" }, features: enterpriseFeaturesSchema.parse({ membership: true, directory: true, messaging: true, sessionSharing: true, resourceManagement: true, resourcePermissions: true, templatePublishing: true, extensionPublishing: true }) };
const departments = [{ id: "company", name: "星河科技", parentId: null }, { id: "product", name: "产品部", parentId: "company" }, { id: "engineering", name: "研发部", parentId: "company" }];
const members = [{ id: "zhang", displayName: "张敏", email: "zhangmin@example.com", departmentId: "product", role: "member", status: "active" }, { id: "li", displayName: "李晨", email: "lichen@example.com", departmentId: "product", role: "member", status: "active" }, { id: "wang", displayName: "王磊", email: "wanglei@example.com", departmentId: "engineering", role: "member", status: "active" }];
const summary = "## 任务背景\n梳理产品页面和交互需求。\n\n## 关键结论\n沿用已经确认的信息结构。\n\n## 下一步\n细化原型和验收条件。";
const message: EnterpriseMessage = { id: "received-share", title: "产品方案讨论总结", kind: "session_share", senderName: "张敏", createdAt: "2026-10-16T02:00:00.000Z", readAt: null, acceptedAt: null, ignoredAt: null, revokedAt: null, markdown: summary, resourceType: null };
let access: EnterpriseAccess = { revision: 0, access: "restricted", memberIds: [], departments: [], groupIds: ["existing-group"] };
let imported: EnterpriseSnapshot | null = null;
let summaryCalls = 0;
let shareCount = 0;
let creates = 0;
let uploads = 0;
const submissions: Record<"template" | "extension", EnterpriseSubmission[]> = { template: [], extension: [] };
let grants = 0;
let recipients = 0;
let failNextShare = false;
const shareKeys = new Set<string>();
const baseFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!url.hostname.endsWith("-proof.invalid")) return baseFetch(input, init);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  if (url.pathname.endsWith("/client-manifest")) return Response.json({ enterprise: initial, features: initial.features });
  if (url.pathname.includes(".well-known")) return Response.json({ serverId: initial.id, name: initial.name, origin: initial.origin, authMode: initial.authMode });
  if (url.pathname.endsWith("/membership")) return Response.json({ membership: { ...initial.membership, displayName: "超管", email: "owner@example.com" } });
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
  if (url.pathname.endsWith("/share-summary")) { summaryCalls++; return Response.json({ item: { title: "产品方案讨论总结", markdown: summary, messageCount: 6, truncated: false } }); }
  if (url.pathname.endsWith("/enterprise-shares/import")) { if (!imported) { imported = body.snapshot; creates++; } return Response.json({ item: { id: "imported-session", title: message.title }, workspaceId: "project-proof" }); }
  if (url.pathname.endsWith("/enterprise-share")) return Response.json({ snapshot: imported });
  if (url.pathname.endsWith("/messages")) return Response.json({ items: [message], nextCursor: null });
  if (url.pathname.endsWith(`/messages/${message.id}`)) return Response.json(message);
  if (url.pathname.endsWith("/read")) { message.readAt = new Date().toISOString(); return Response.json({ ok: true }); }
  if (url.pathname.endsWith("/accept")) { message.acceptedAt = new Date().toISOString(); return Response.json({ ok: true }); }
  if (url.pathname.endsWith("/ignore")) { message.ignoredAt = new Date().toISOString(); return Response.json({ ok: true }); }
  if (url.pathname.endsWith("/access")) { if (method === "PUT") { access = { ...body, revision: access.revision + 1 }; grants++; } return Response.json(access); }
  if (url.pathname.endsWith("-submissions")) {
    const type = url.pathname.endsWith("/template-submissions") ? "template" : "extension";
    if (method === "POST") { uploads++; const item: EnterpriseSubmission = { resourceId: `${type}-submission-${uploads}`, resourceName: type === "template" ? "我的企业模板" : "我的企业插件", version: "1.0.0", reviewStatus: "pending", reviewNote: null }; submissions[type].push(item); return Response.json(item); }
    return Response.json({ items: submissions[type] });
  }
  if (url.pathname.endsWith("/resources")) {
    const type = url.searchParams.get("type") ?? "template";
    return Response.json({ items: [{ id: `${type}-1`, type, name: type === "template" ? "产品提案模板" : "产品调研助手", status: "published", access: "restricted", ownerName: "张敏", latestVersion: { version: "1.2.0", reviewStatus: "approved" } }, { id: `${type}-2`, type, name: type === "template" ? "待审核报告模板" : "待审核调研插件", status: "draft", access: "admins", ownerName: "王磊", latestVersion: { version: "1.0.0", reviewStatus: "pending" } }], nextCursor: null });
  }
  if (url.pathname.endsWith("/review") || method === "PATCH") return Response.json({ ok: true });
  return Response.json({ error: "not_found" }, { status: 404 });
};
saveEnterpriseConnection(initial);
localStorage.setItem("ipollowork.work-context.v1", "enterprise:ent_proof");
localStorage.setItem("ipollowork.language", "zh");
const client = createiPolloWorkServerClient({ baseUrl: "https://local-proof.invalid", token: "synthetic-local-token" });

function Proof() {
  const [connection, setConnection] = useState(initial);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const inbox = useEnterpriseMessages(connection);
  return <main className="min-h-screen bg-background p-6 text-foreground"><div className="mx-auto max-w-5xl space-y-5">
    <div><h1 className="text-xl font-semibold">企业协作功能验证</h1><p className="mt-2 text-sm text-muted-foreground">隔离界面验证 · 企业和模型返回使用合成数据 · 生产控件直接复用</p></div>
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4"><span className="mr-auto text-sm font-medium">{connection.name} · {connection.membership.role === "owner" ? "企业超管" : "员工"}</span><Button data-testid="proof-share" disabled={!connection.features?.sessionSharing} onClick={() => requestEnterpriseSessionShare("project-proof", "source-session")}>分享产品讨论</Button><EnterpriseResourceControls connection={connection} type="template" /><EnterpriseResourceControls connection={connection} type="extension" /></section>
    <div className="grid gap-5 md:grid-cols-[360px_minmax(0,1fr)]"><section className="overflow-hidden rounded-xl border border-border"><EnterpriseMessageList key={`${connection.id}:${connection.membership.id}`} connection={connection} inbox={inbox} onExit={() => setRevision((value) => value + 1)} /></section><section className="rounded-xl border border-border p-4"><h2 className="mb-3 text-sm font-semibold">接收后的会话</h2>{sessionId ? <><p className="text-sm">产品方案讨论 · 独立会话</p><EnterpriseSnapshotNotice key={revision} connection={connection} client={client} workspaceId="project-proof" sessionId={sessionId} /><p className="mt-3 text-xs text-muted-foreground">等待用户继续提问，未启动模型执行。</p></> : <p className="py-12 text-center text-sm text-muted-foreground">接收分享后在此打开独立会话</p>}</section></div>
    <section className="flex flex-wrap gap-2"><Button variant="outline" data-testid="proof-fail-send" onClick={() => { failNextShare = true; }}>模拟下一次发送失败</Button><Button variant="outline" data-testid="proof-member" onClick={() => { const next = { ...initial, membership: { ...initial.membership, role: "member" } } satisfies EnterpriseConnection; saveEnterpriseConnection(next); setConnection(next); }}>切换员工</Button><Button variant="outline" data-testid="proof-legacy" onClick={() => { const next = { ...initial, features: enterpriseFeaturesSchema.parse({}) }; saveEnterpriseConnection(next); setConnection(next); }}>旧企业服务</Button><Button variant="outline" onClick={() => { saveEnterpriseConnection(initial); setConnection(initial); }}>恢复超管</Button><Button variant="outline" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>切换深色</Button><Button variant="outline" data-testid="proof-stats" onClick={() => setRevision((value) => value + 1)}>刷新验证记录</Button></section>
    <p data-testid="proof-result" className="text-xs text-muted-foreground">总结生成次数 {summaryCalls} · 分享次数 {shareCount} · 分享对象 {recipients} 人 · 本机创建次数 {creates} · 投稿次数 {uploads} · 权限保存次数 {grants}</p>
    <EnterpriseSessionSharing key={`${connection.id}:${connection.membership.id}`} connection={connection} currentWorkspaceId="project-proof" resolveWorkspace={() => ({ client, workspaceId: "project-proof" })} model={{ providerID: "proof", modelID: "proof-model" }} engineId="opencode" onImported={(_workspaceId, id) => { setSessionId(id); setRevision((value) => value + 1); inbox.refresh(); }} />
    <Toaster />
  </div></main>;
}
createRoot(document.getElementById("root")!).render(<HashRouter><Proof /></HashRouter>);
