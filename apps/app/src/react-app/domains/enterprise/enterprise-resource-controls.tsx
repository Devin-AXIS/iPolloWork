import type { EnterpriseResourceType } from "@ipollowork/types/enterprise";
import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import type { EnterpriseAccess, EnterpriseManagedResource, EnterpriseSubmission } from "@ipollowork/types/enterprise";
import { MAX_TEMPLATE_PACKAGE_BYTES } from "@ipollowork/types/templates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { canManageEnterprise, enterpriseApi, enterpriseErrorMessage, enterpriseIdentity } from "@/app/lib/enterprise-client";
import { refreshEnterpriseMembership, type EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { EnterprisePeoplePicker } from "./enterprise-people-picker";

const REVIEW_LABELS = { pending: "待审核", approved: "已通过", rejected: "已退回" };
const STATUS_LABELS = { draft: "草稿", published: "已发布", archived: "已下架" };

function ResourceAccessDialog({ connection, resource, onClose, onSaved }: {
  connection: EnterpriseConnection; resource: EnterpriseManagedResource; onClose: () => void; onSaved: () => void;
}) {
  const [access, setAccess] = useState<EnterpriseAccess | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void enterpriseApi.access(connection, resource.id, resource.type).then((value) => { if (current) { setAccess(value); setIncludeDescendants(value.departments.length ? value.departments.every((item) => item.includeDescendants) : true); } })
      .catch((cause: unknown) => { if (current) setError(enterpriseErrorMessage(cause)); });
    return () => { current = false; };
  }, [connection.id, connection.origin, connection.membership.id, connection.session.token, resource.id]);
  const save = async () => {
    if (!access) return;
    setBusy(true); setError(null);
    try { await enterpriseApi.setAccess(connection, resource.id, access, resource.type); onSaved(); onClose(); }
    catch (cause) { setError(enterpriseErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto" data-testid="enterprise-resource-access"><DialogHeader><DialogTitle>分配资源权限</DialogTitle><DialogDescription>{resource.name} · {connection.name}</DialogDescription></DialogHeader>
    {error ? <p role="alert" className="rounded-lg bg-feedback-error p-3 text-sm text-red-11">{error}</p> : null}
    {access ? <>
      <div role="group" aria-label="访问范围" className="flex flex-wrap gap-2">{(["restricted", "all", "admins"] as const).map((scope) => <Button key={scope} variant={access.access === scope ? "secondary" : "outline"} size="sm" disabled={busy} onClick={() => setAccess({ ...access, access: scope })}>{scope === "restricted" ? "指定人员和部门" : scope === "all" ? "全体成员" : "仅管理员"}</Button>)}</div>
      {access.access === "restricted" ? <><EnterprisePeoplePicker connection={connection} disabled={busy} allowDepartments value={{ memberIds: access.memberIds, departmentIds: access.departments.map((item) => item.id) }} onChange={(selected) => setAccess({ ...access, memberIds: selected.memberIds, departments: selected.departmentIds.map((id) => access.departments.find((item) => item.id === id) ?? { id, includeDescendants }) })} />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeDescendants} indeterminate={access.departments.some((item) => item.includeDescendants) && !access.departments.every((item) => item.includeDescendants)} disabled={busy} onCheckedChange={(checked) => { setIncludeDescendants(checked); setAccess({ ...access, departments: access.departments.map((item) => ({ ...item, includeDescendants: checked })) }); }} />部门授权包含下级部门</label>
      </> : null}
      <p className="text-xs text-muted-foreground">保存后通知员工。清空指定对象可收回该范围权限，已下载的本地副本另行管理。</p>
    </> : !error ? <p role="status">正在读取权限</p> : null}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || !access} onClick={() => void save()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}保存并下发</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function EnterpriseResourceControls({ connection, type, onChanged }: {
  connection: EnterpriseConnection; type: EnterpriseResourceType; onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"manage" | "mine">("mine");
  const [resources, setResources] = useState<EnterpriseManagedResource[]>([]);
  const [submissions, setSubmissions] = useState<EnterpriseSubmission[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessResource, setAccessResource] = useState<EnterpriseManagedResource | null>(null);
  const [reviewResource, setReviewResource] = useState<EnterpriseManagedResource | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const manager = canManageEnterprise(connection, type);
  const publishing = type === "template" ? connection.features?.templatePublishing : type === "skill" ? connection.features?.skillPublishing : connection.features?.extensionPublishing;
  const label = type === "template" ? "模板" : type === "skill" ? "技能" : "插件";
  const identity = enterpriseIdentity(connection);
  useEffect(() => { setOpen(false); setResources([]); setSubmissions([]); setAccessResource(null); setReviewResource(null); setFile(null); setError(null); setNotice(null); setBusy(false); epoch.current += 1; }, [identity]);
  useEffect(() => { setError(null); setNotice(null); if (!manager) { setView("mine"); setResources([]); setCursor(null); setAccessResource(null); setReviewResource(null); setBusy(false); epoch.current += 1; } }, [manager]);
  const openControls = async () => {
    setBusy(true); setError(null);
    try {
      const verified = await refreshEnterpriseMembership(connection);
      setView(canManageEnterprise(verified, type) ? "manage" : "mine");
      setOpen(true);
    } catch (cause) { setError(enterpriseErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const refresh = async (more = false) => {
    const request = ++epoch.current;
    setBusy(true); setError(null);
    try {
      if (view === "manage") {
        if (!manager || !connection.features?.resourceManagement) throw new Error("enterprise_feature_unavailable");
        const page = await enterpriseApi.resources(connection, type, more ? cursor : null, search);
        if (request === epoch.current) { setResources((current) => more ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()].slice(0, 500) : page.items); setCursor(page.nextCursor === cursor && more ? null : page.nextCursor); }
      } else {
        if (!publishing) throw new Error("enterprise_feature_unavailable");
        const page = await enterpriseApi.submissions(connection, type);
        if (request === epoch.current) setSubmissions(page.items);
      }
    } catch (cause) { if (request === epoch.current) setError(enterpriseErrorMessage(cause)); }
    finally { if (request === epoch.current) setBusy(false); }
  };
  useEffect(() => { const timer = open ? window.setTimeout(() => void refresh(), search ? 250 : 0) : undefined; return () => { window.clearTimeout(timer); epoch.current += 1; }; }, [open, view, identity, type, search]);
  const mutation = async (action: () => Promise<unknown>, success: string) => {
    const request = epoch.current;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); if (request !== epoch.current) return; setNotice(success); setFile(null); onChanged?.(); await refresh(); }
    catch (cause) { if (request === epoch.current) setError(enterpriseErrorMessage(cause)); }
    finally { if (request === epoch.current) setBusy(false); }
  };
  const upload = () => {
    if (!file || !publishing) return;
    const valid = type === "template" ? /\.(ipwp|ipwt)$/i.test(file.name) : type === "skill" ? /\.(md|ipollowork-skill)$/i.test(file.name) : /\.ipollowork-plugin$/i.test(file.name);
    const maximum = type === "skill" && /\.md$/i.test(file.name) ? 1024 * 1024 : MAX_TEMPLATE_PACKAGE_BYTES;
    if (!valid || !file.size || file.size > maximum) { setError(`请选择有效的${label}${type === "skill" ? "文件" : "包"}，文件大小不能超过 ${Math.round(maximum / 1024 / 1024)} MB。`); return; }
    void mutation(() => enterpriseApi.submit(connection, type, file), "投稿已提交，可在我的投稿中查看审核状态。");
  };
  return <>
    <Button variant="outline" size="sm" data-testid={`enterprise-${type}-manage`} disabled={busy} onClick={() => void openControls()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{manager ? `${label}管理` : `我的${label}投稿`}</Button>
    {!open && error ? <p role="alert" className="text-xs text-red-11">{error}</p> : null}
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto" data-testid="enterprise-resource-management"><DialogHeader><DialogTitle>{manager ? `企业${label}管理` : `我的${label}投稿`}</DialogTitle><DialogDescription>{connection.name} · {manager ? "查看资源和投稿，分配使用权限" : "提交自己制作的资源，查看审核结果"}</DialogDescription></DialogHeader>
      <div className="flex flex-wrap items-center gap-2"><div role="group" aria-label="资源视图" className="flex gap-2">{manager ? <Button size="sm" variant={view === "manage" ? "secondary" : "ghost"} disabled={busy} onClick={() => setView("manage")}>全部企业{label}</Button> : null}<Button size="sm" variant={view === "mine" ? "secondary" : "ghost"} disabled={busy} onClick={() => setView("mine")}>我的投稿</Button></div><Button className="ml-auto" variant="ghost" size="icon-sm" aria-label="刷新企业资源" disabled={busy} onClick={() => void refresh()}><RefreshCw className="size-4" /></Button></div>
      <div className="flex flex-wrap items-center gap-2"><input ref={input} type="file" accept={type === "template" ? ".ipwp,.ipwt" : type === "skill" ? ".md,.ipollowork-skill" : ".ipollowork-plugin"} className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><Button variant="outline" size="sm" disabled={busy || !publishing} onClick={() => input.current?.click()}><Upload className="size-4" />选择{label}{type === "skill" ? "文件" : "包"}</Button><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{file?.name ?? (type === "skill" ? "支持技能 MD 或 .ipollowork-skill 包，审核后在企业内分发" : `上传自己制作的${label}，审核后在企业内分发`)}</span><Button size="sm" disabled={busy || !file || !publishing} onClick={upload}>提交审核</Button></div>
      {!publishing ? <p className="text-xs text-muted-foreground">当前企业服务尚未开放员工{label}投稿，请联系管理员升级。</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-feedback-error p-3 text-sm text-red-11">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg bg-feedback-success p-3 text-sm">{notice}</p> : null}
      {busy ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />正在处理</p> : null}
      {view === "manage" && manager ? <><label className="space-y-1.5"><span className="text-xs font-medium">搜索企业资源</span><Input value={search} maxLength={160} onChange={(event) => setSearch(event.target.value)} placeholder="名称或作者" /></label><div className="space-y-2">
        {resources.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{STATUS_LABELS[item.status]} · {item.latestVersion ? `v${item.latestVersion.version} · ${REVIEW_LABELS[item.latestVersion.reviewStatus]}` : "暂无版本"}{item.ownerName ? ` · ${item.ownerName}` : ""}</p></div>
          <Button size="sm" variant="outline" disabled={busy || !connection.features?.resourcePermissions} onClick={() => setAccessResource(item)}>分配权限</Button>
          {item.latestVersion?.reviewStatus === "pending" ? <Button size="sm" disabled={busy} onClick={() => { setReviewResource(item); setReviewNote(""); }}>审核</Button> : null}
          {item.status === "published" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void mutation(() => enterpriseApi.archive(connection, item.id, type), "资源已下架。")}>下架</Button> : null}
        </article>)}
        {!resources.length && !busy && !error ? <p className="py-8 text-center text-sm text-muted-foreground">企业中暂无{label}</p> : null}
      </div>{cursor && resources.length < 500 ? <Button variant="outline" disabled={busy} onClick={() => void refresh(true)}>加载更多资源</Button> : null}{resources.length >= 500 ? <p className="text-xs text-muted-foreground">已显示前 500 个资源，请在企业管理服务中查看完整列表。</p> : null}</> : <div className="space-y-2">{submissions.map((item) => <article key={`${item.resourceId}:${item.version}`} className="rounded-xl border border-border p-3"><p className="text-sm font-medium">{item.resourceName || label} · v{item.version}</p><p className="mt-1 text-xs text-muted-foreground">{REVIEW_LABELS[item.reviewStatus]}{item.reviewNote ? ` · ${item.reviewNote}` : ""}</p></article>)}{!submissions.length && !busy && !error ? <p className="py-8 text-center text-sm text-muted-foreground">还没有投稿，选择自己的{label}{type === "skill" ? "文件" : "包"}提交审核。</p> : null}</div>}
    </DialogContent></Dialog>
    {manager && accessResource ? <ResourceAccessDialog connection={connection} resource={accessResource} onClose={() => setAccessResource(null)} onSaved={() => { setNotice("权限已保存并下发。"); void refresh(); }} /> : null}
    <Dialog open={manager && Boolean(reviewResource)} onOpenChange={(value) => { if (!value && !busy) setReviewResource(null); }}><DialogContent><DialogHeader><DialogTitle>审核{label}投稿</DialogTitle><DialogDescription>{reviewResource?.name}</DialogDescription></DialogHeader><label className="space-y-1.5"><span className="text-sm">审核说明</span><Textarea value={reviewNote} maxLength={1000} onChange={(event) => setReviewNote(event.target.value)} placeholder="退回时请说明需要修改的内容" /></label><DialogFooter>{(["rejected", "approved"] as const).map((decision) => <Button key={decision} variant={decision === "approved" ? "default" : "outline"} disabled={busy || (decision === "rejected" && !reviewNote.trim())} onClick={() => { const item = reviewResource; const version = item?.latestVersion?.version; if (item && version) void mutation(async () => { await enterpriseApi.review(connection, item.id, version, decision, reviewNote, type); setReviewResource(null); }, decision === "approved" ? "版本已审核通过。" : "投稿已退回。"); }}>{decision === "approved" ? "通过并发布" : "退回修改"}</Button>)}</DialogFooter></DialogContent></Dialog>
  </>;
}
