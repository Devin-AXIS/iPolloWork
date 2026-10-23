import type { EnterpriseResourceType } from "@ipollowork/types/enterprise";
import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, ArrowLeft, Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import type { EnterpriseAccess, EnterpriseManagedResource, EnterpriseSubmission } from "@ipollowork/types/enterprise";
import { MAX_TEMPLATE_PACKAGE_BYTES } from "@ipollowork/types/templates";
import { Button, ButtonStyleScopeProvider } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { FileUpload, FileUploadItem } from "@/components/ui/file-upload";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { canManageEnterprise, enterpriseApi, enterpriseErrorMessage, enterpriseIdentity } from "@/app/lib/enterprise-client";
import { refreshEnterpriseMembership, type EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { toast } from "@/components/ui/sonner";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { EnterprisePeoplePicker } from "./enterprise-people-picker";

const REVIEW_LABELS = { pending: "待审核", approved: "已通过", rejected: "已退回" };
const STATUS_LABELS = { draft: "草稿", published: "已发布", archived: "已下架" };

function ResourceAccessPanel({ connection, resource, busy, onBusyChange, onClose, onSaved }: {
  connection: EnterpriseConnection; resource: Pick<EnterpriseManagedResource, "id" | "name" | "type">; busy: boolean; onBusyChange: (busy: boolean) => void; onClose: () => void; onSaved: () => void;
}) {
  const accessFieldId = useId();
  const [access, setAccess] = useState<EnterpriseAccess | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void enterpriseApi.access(connection, resource.id, resource.type).then((value) => { if (current) { setAccess(value); setIncludeDescendants(value.departments.length ? value.departments.every((item) => item.includeDescendants) : true); } })
      .catch((cause: unknown) => { if (current) setError(enterpriseErrorMessage(cause)); });
    return () => { current = false; };
  }, [connection.id, connection.origin, connection.membership.id, connection.session.token, resource.id]);
  const save = async () => {
    if (!access) return;
    onBusyChange(true); setError(null);
    try { await enterpriseApi.setAccess(connection, resource.id, access, resource.type); onSaved(); onClose(); }
    catch (cause) { setError(enterpriseErrorMessage(cause)); }
    finally { onBusyChange(false); }
  };
  return <div className="space-y-4"><DialogHeader><DialogTitle>分配资源权限</DialogTitle><DialogDescription>{resource.name} · {connection.name}</DialogDescription></DialogHeader>
    {error ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert> : null}
    {access ? <>
      <RadioGroup aria-label="访问范围" value={access.access} disabled={busy} className="flex flex-wrap gap-x-5 gap-y-3" onValueChange={(value) => { if (value === "restricted" || value === "all" || value === "admins") setAccess({ ...access, access: value }); }}>
        {(["restricted", "all", "admins"] as const).map((scope) => <Field key={scope} orientation="horizontal" className="w-auto"><RadioGroupItem id={`${accessFieldId}-${scope}`} value={scope} /><FieldLabel htmlFor={`${accessFieldId}-${scope}`}>{scope === "restricted" ? "指定人员和部门" : scope === "all" ? "全体成员" : "仅管理员"}</FieldLabel></Field>)}
      </RadioGroup>
      {access.access === "restricted" ? <><EnterprisePeoplePicker connection={connection} disabled={busy} allowDepartments value={{ memberIds: access.memberIds, departmentIds: access.departments.map((item) => item.id) }} onChange={(selected) => setAccess({ ...access, memberIds: selected.memberIds, departments: selected.departmentIds.map((id) => access.departments.find((item) => item.id === id) ?? { id, includeDescendants }) })} />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeDescendants} indeterminate={access.departments.some((item) => item.includeDescendants) && !access.departments.every((item) => item.includeDescendants)} disabled={busy} onCheckedChange={(checked) => { setIncludeDescendants(checked); setAccess({ ...access, departments: access.departments.map((item) => ({ ...item, includeDescendants: checked })) }); }} />部门授权包含下级部门</label>
      </> : null}
      <p className="text-xs text-muted-foreground">保存后通知员工。清空指定对象可收回该范围权限，已下载的本地副本另行管理。</p>
    </> : !error ? <p role="status">正在读取权限</p> : null}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || !access} onClick={() => void save()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}保存并下发</Button></DialogFooter>
  </div>;
}

export type EnterpriseResourceAction = {
  resource: Pick<EnterpriseManagedResource, "id" | "name" | "type">;
  kind: "access" | "archive";
};

export function EnterpriseResourceActionDialog({ connection, action, onClose, onChanged }: {
  connection: EnterpriseConnection; action: EnterpriseResourceAction; onClose: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLElement>(null);
  const manager = canManageEnterprise(connection, action.resource.type);
  useEffect(() => { trigger.current = document.querySelector<HTMLElement>(`button[aria-label=${JSON.stringify(`${action.resource.name}的操作`)}]`); }, [action.resource.id, action.resource.name]);
  useEffect(() => { if (!manager) onClose(); }, [manager, onClose]);
  const close = () => { if (!busy) { onClose(); requestAnimationFrame(() => trigger.current?.focus()); } };
  const archive = async () => {
    setBusy(true); setError(null);
    try { await enterpriseApi.archive(connection, action.resource.id, action.resource.type); onChanged(); onClose(); toast.success("资源已下架。"); }
    catch (cause) { setError(enterpriseErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (!manager) return null;
  if (action.kind === "archive") return <ConfirmModal open title="下架企业资源" message={`下架“${action.resource.name}”后，成员将无法再从企业目录获取它；已下载的本地副本另行管理。`} confirmLabel="下架" cancelLabel="取消" busy={busy} variant="danger" onConfirm={() => void archive()} onCancel={close}>{error ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert> : null}</ConfirmModal>;
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent finalFocus={trigger} className="max-h-[90dvh] max-w-[640px] overflow-y-auto" data-testid="enterprise-card-access"><ResourceAccessPanel connection={connection} resource={action.resource} busy={busy} onBusyChange={setBusy} onClose={onClose} onSaved={() => { onChanged(); toast.success("权限已保存并下发。"); }} /></DialogContent></Dialog>;
}

export type EnterpriseResourceSubmission = { name: string; prepareFile: () => Promise<File> };

export function EnterpriseResourceSubmissionDialog({ connection, type, submission, onClose }: {
  connection: EnterpriseConnection; type: EnterpriseResourceType; submission: EnterpriseResourceSubmission; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    trigger.current = document.querySelector<HTMLElement>(`button[aria-label=${JSON.stringify(`${submission.name}的操作`)}]`);
    return () => { active.current = false; };
  }, [submission]);
  const publishing = type === "template" ? connection.features?.templatePublishing : type === "skill" ? connection.features?.skillPublishing : connection.features?.extensionPublishing;
  const submit = async () => {
    if (busy || !publishing) return;
    setBusy(true); setError(null);
    try {
      const file = await submission.prepareFile();
      if (!active.current) return;
      await enterpriseApi.submit(connection, type, file);
      if (!active.current) return;
      toast.success("投稿已提交，等待企业审核。");
      onClose();
    } catch (cause) { if (active.current) setError(enterpriseErrorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent finalFocus={trigger} className="max-w-md" data-testid="enterprise-card-submission">
    <DialogHeader><DialogTitle>投稿到企业</DialogTitle><DialogDescription>将“{submission.name}”提交到{connection.name}，审核通过后在企业内分发。</DialogDescription></DialogHeader>
    {error ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert> : null}
    {!publishing ? <Alert><AlertDescription>当前企业尚未开放此类资源投稿。</AlertDescription></Alert> : null}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || !publishing} onClick={() => void submit()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}{busy ? "正在提交" : "提交审核"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function EnterpriseResourceControls({ connection, type, onChanged, mode = "manage" }: {
  connection: EnterpriseConnection; type: EnterpriseResourceType; onChanged?: () => void; mode?: "manage" | "submissions";
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
  const [accessBusy, setAccessBusy] = useState(false);
  const returnFocusId = useRef<string | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const actionId = useId();
  const searchId = useId();
  const reviewNoteId = useId();
  const epoch = useRef(0);
  const manager = mode === "manage" && canManageEnterprise(connection, type);
  const publishing = type === "template" ? connection.features?.templatePublishing : type === "skill" ? connection.features?.skillPublishing : connection.features?.extensionPublishing;
  const label = type === "template" ? "模板" : type === "skill" ? "技能" : "插件";
  const identity = enterpriseIdentity(connection);
  useEffect(() => { setOpen(false); setResources([]); setSubmissions([]); setAccessResource(null); setReviewResource(null); setFile(null); setError(null); setNotice(null); setBusy(false); setAccessBusy(false); returnFocusId.current = null; epoch.current += 1; }, [identity]);
  useEffect(() => { setError(null); setNotice(null); if (!manager) { setView("mine"); setResources([]); setCursor(null); setAccessBusy(false); setAccessResource(null); setReviewResource(null); setBusy(false); epoch.current += 1; } }, [manager]);
  const backToResources = () => { setAccessResource(null); setReviewResource(null); };
  useEffect(() => {
    if (open && (accessResource || reviewResource)) backButton.current?.focus();
  }, [open, accessResource, reviewResource]);
  useEffect(() => {
    if (!open || accessResource || reviewResource) return;
    if (!busy && !accessBusy && returnFocusId.current) {
      document.getElementById(returnFocusId.current)?.focus();
      returnFocusId.current = null;
    }
  }, [open, accessResource, reviewResource, busy, accessBusy]);
  const openControls = async () => {
    setBusy(true); setError(null);
    try {
      const verified = await refreshEnterpriseMembership(connection);
      setView(mode === "manage" && canManageEnterprise(verified, type) ? "manage" : "mine");
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
  return <ButtonStyleScopeProvider value="settings" flat>
    <Button ref={trigger} variant="outline" size="sm" data-testid={`enterprise-${type}-${mode === "submissions" ? "submissions" : "manage"}`} disabled={busy || accessBusy} onClick={() => void openControls()}>{busy ? <Loader2 className="size-4 animate-spin" /> : manager ? <ShieldCheck className="size-4" /> : <Upload className="size-4" />}{mode === "submissions" ? "我的投稿" : manager ? `${label}管理` : `我的${label}投稿`}</Button>
    {!open && error ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert> : null}
    <Dialog open={open} onOpenChange={(value, details) => { if (busy || accessBusy) return; if (!value && details.reason === "escape-key" && (accessResource || reviewResource)) { details.cancel(); backToResources(); return; } setOpen(value); if (!value) { backToResources(); returnFocusId.current = null; } }}><DialogContent finalFocus={trigger} className="max-h-[90dvh] max-w-[640px] overflow-y-auto" data-testid={accessResource ? "enterprise-resource-access" : reviewResource ? "enterprise-resource-review" : "enterprise-resource-management"}>{accessResource || reviewResource ? <>
      <Button ref={backButton} variant="ghost" size="sm" className="w-fit" disabled={busy || accessBusy} onClick={backToResources}><ArrowLeft className="size-4" aria-hidden="true" />返回资源列表</Button>
      {accessResource ? <ResourceAccessPanel connection={connection} resource={accessResource} busy={accessBusy} onBusyChange={setAccessBusy} onClose={backToResources} onSaved={() => { setNotice("权限已保存并下发。"); void refresh(); }} /> : <div className="space-y-4"><DialogHeader><DialogTitle>审核{label}投稿</DialogTitle><DialogDescription>{reviewResource?.name}</DialogDescription></DialogHeader>{error ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert> : null}<Field><FieldLabel htmlFor={reviewNoteId}>审核说明</FieldLabel><Textarea id={reviewNoteId} disabled={busy} value={reviewNote} maxLength={1000} onChange={(event) => setReviewNote(event.target.value)} placeholder="退回时请说明需要修改的内容" /></Field><DialogFooter><Button variant="outline" disabled={busy} onClick={backToResources}>取消</Button>{(["rejected", "approved"] as const).map((decision) => <Button key={decision} variant={decision === "approved" ? "default" : "outline"} disabled={busy || (decision === "rejected" && !reviewNote.trim())} onClick={() => { const item = reviewResource; const version = item?.latestVersion?.version; if (item && version) void mutation(async () => { await enterpriseApi.review(connection, item.id, version, decision, reviewNote, type); backToResources(); }, decision === "approved" ? "版本已审核通过。" : "投稿已退回。"); }}>{decision === "approved" ? "通过并发布" : "退回修改"}</Button>)}</DialogFooter></div>}
    </> : <><DialogHeader><DialogTitle>{manager ? `企业${label}管理` : `我的${label}投稿`}</DialogTitle><DialogDescription>{connection.name} · {manager ? "查看资源和投稿，分配使用权限" : "提交自己制作的资源，查看审核结果"}</DialogDescription></DialogHeader>
      <Tabs className="gap-4" value={view} onValueChange={(value) => { if (value === "manage" || value === "mine") setView(value); }}>
      <div className="flex flex-wrap items-center gap-2"><TabsList aria-label="资源视图">{manager ? <TabsTrigger value="manage" disabled={busy}>全部企业{label}</TabsTrigger> : null}<TabsTrigger value="mine" disabled={busy}>我的投稿</TabsTrigger></TabsList><Button className="ml-auto" variant="ghost" size="icon-sm" aria-label="刷新企业资源" disabled={busy} onClick={() => void refresh()}><RefreshCw className="size-4" /></Button></div>
      <FileUpload label={`选择${label}${type === "skill" ? "文件" : "包"}`} description={type === "skill" ? "支持技能 MD 或 .ipollowork-skill 包，审核后在企业内分发" : `上传自己制作的${label}，审核后在企业内分发`}
        accept={type === "template" ? ".ipwp,.ipwt" : type === "skill" ? ".md,.ipollowork-skill" : ".ipollowork-plugin"} maxSize={MAX_TEMPLATE_PACKAGE_BYTES} disabled={busy || !publishing}
        messages={{ invalidType: `请选择有效的${label}${type === "skill" ? "文件" : "包"}。`, empty: "请选择非空文件。", tooLarge: `文件大小不能超过 ${Math.round(MAX_TEMPLATE_PACKAGE_BYTES / 1024 / 1024)} MB。`, tooMany: "每次只能选择一个文件。" }}
        validate={(selected) => type === "skill" && /\.md$/i.test(selected.name) && selected.size > 1024 * 1024 ? "技能 MD 文件大小不能超过 1 MB。" : null}
        onFilesSelected={(files) => setFile(files[0] ?? null)} onError={(message) => setError(message || null)} />
      {file ? <FileUploadItem name={file.name} status="ready" statusLabel="已选择，提交后等待审核" onRemove={busy ? undefined : () => setFile(null)} removeLabel="移除已选文件" /> : null}
      <div className="flex justify-end"><Button size="sm" disabled={busy || !file || !publishing} onClick={upload}>提交审核</Button></div>
      {!publishing ? <p className="text-xs text-muted-foreground">当前企业服务尚未开放员工{label}投稿，请联系管理员升级。</p> : null}
      {error ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert variant="success" role="status"><CircleCheck aria-hidden="true" /><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {busy ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />正在处理</p> : null}
      {manager ? <TabsContent value="manage" className="space-y-4"><Field><FieldLabel htmlFor={searchId}>搜索企业资源</FieldLabel><SearchField id={searchId} value={search} maxLength={160} onValueChange={setSearch} clearLabel="清除资源搜索" placeholder="名称或作者" /></Field><div className="space-y-2">
        {resources.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{STATUS_LABELS[item.status]} · {item.latestVersion ? `v${item.latestVersion.version} · ${REVIEW_LABELS[item.latestVersion.reviewStatus]}` : "暂无版本"}{item.ownerName ? ` · ${item.ownerName}` : ""}</p></div>
          <Button size="sm" variant="outline" disabled={busy || !connection.features?.resourcePermissions} id={`${actionId}-access-${item.id}`} onClick={(event) => { returnFocusId.current = event.currentTarget.id; setAccessResource(item); }}>分配权限</Button>
          {item.latestVersion?.reviewStatus === "pending" ? <Button size="sm" disabled={busy} id={`${actionId}-review-${item.id}`} onClick={(event) => { returnFocusId.current = event.currentTarget.id; setError(null); setReviewResource(item); setReviewNote(""); }}>审核</Button> : null}
          {item.status === "published" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void mutation(() => enterpriseApi.archive(connection, item.id, type), "资源已下架。")}>下架</Button> : null}
        </article>)}
        {!resources.length && !busy && !error ? <Empty variant="ghost"><EmptyDescription>{search.trim() ? `没有匹配的${label}` : `企业中暂无${label}`}</EmptyDescription>{search.trim() ? <Button variant="outline" size="sm" onClick={() => setSearch("")}>清除搜索</Button> : null}</Empty> : null}
      </div>{cursor && resources.length < 500 ? <Button variant="outline" disabled={busy} onClick={() => void refresh(true)}>加载更多资源</Button> : null}{resources.length >= 500 ? <p className="text-xs text-muted-foreground">已显示前 500 个资源，请在企业管理服务中查看完整列表。</p> : null}</TabsContent> : null}<TabsContent value="mine" className="space-y-2">{submissions.map((item) => <article key={`${item.resourceId}:${item.version}`} className="rounded-xl border border-border p-3"><p className="text-sm font-medium">{item.resourceName || label} · v{item.version}</p><p className="mt-1 text-xs text-muted-foreground">{REVIEW_LABELS[item.reviewStatus]}{item.reviewNote ? ` · ${item.reviewNote}` : ""}</p></article>)}{!submissions.length && !busy && !error ? <Empty variant="ghost"><EmptyDescription>还没有投稿，选择自己的{label}{type === "skill" ? "文件" : "包"}提交审核。</EmptyDescription></Empty> : null}</TabsContent>
      </Tabs>
    </>}
    </DialogContent>
    </Dialog>
  </ButtonStyleScopeProvider>;
}
