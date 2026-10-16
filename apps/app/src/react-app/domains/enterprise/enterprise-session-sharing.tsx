import { useEffect, useRef, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { enterpriseShareTargetSchema, enterpriseSummarySchema, enterpriseSnapshotSchema, type EnterpriseSnapshot, type EnterpriseSummary } from "@ipollowork/types/enterprise";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { enterpriseApi, enterpriseErrorMessage, enterpriseImportMessageEvent, enterpriseShareSessionEvent, takeEnterpriseMessageImport } from "@/app/lib/enterprise-client";
import { EnterprisePeoplePicker, type EnterprisePeopleSelection } from "./enterprise-people-picker";

export type EnterpriseWorkspaceEndpoint = { client: iPolloWorkServerClient; workspaceId: string };

export function EnterpriseSessionSharing({ connection, resolveWorkspace, currentWorkspaceId, onImported, model, engineId }: {
  connection: EnterpriseConnection;
  resolveWorkspace: (id: string) => EnterpriseWorkspaceEndpoint | null;
  currentWorkspaceId: string;
  onImported: (workspaceId: string, sessionId: string) => void;
  model?: { providerID: string; modelID: string } | null;
  engineId?: string;
}) {
  const [target, setTarget] = useState<{ workspaceId: string; sessionId: string } | null>(null);
  const [selected, setSelected] = useState<EnterprisePeopleSelection>({ memberIds: [], departmentIds: [] });
  const [summary, setSummary] = useState<EnterpriseSummary | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const key = useRef(crypto.randomUUID());
  const alive = useRef(true);
  const options = useRef({ connection, resolveWorkspace, currentWorkspaceId, onImported, model, engineId });
  options.current = { connection, resolveWorkspace, currentWorkspaceId, onImported, model, engineId };
  const importingRef = useRef(false);
  useEffect(() => {
    alive.current = true;
    const share = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = enterpriseShareTargetSchema.safeParse(event.detail);
      if (!parsed.success || !options.current.resolveWorkspace(parsed.data.workspaceId)) return;
      setTarget(parsed.data); setSummary(null); setError(null); setSelected({ memberIds: [], departmentIds: [] }); key.current = crypto.randomUUID();
    };
    const receive = () => {
      if (importingRef.current) return;
      const current = options.current;
      const messageId = takeEnterpriseMessageImport(current.connection);
      if (!messageId) return;
      importingRef.current = true; setImporting(true); setImportError(null);
      void (async () => {
        const endpoint = current.resolveWorkspace(current.currentWorkspaceId);
        if (!endpoint) throw new Error("enterprise_context_mismatch");
        const message = await enterpriseApi.message(current.connection, messageId);
        if (message.kind !== "session_share" || message.revokedAt || !message.markdown) throw new Error("enterprise_share_unavailable");
        const snapshot = enterpriseSnapshotSchema.parse({ enterpriseId: current.connection.id, memberId: current.connection.membership.id, shareId: message.id, title: message.title, senderName: message.senderName, markdown: message.markdown, createdAt: message.createdAt });
        if (!alive.current) return;
        const { item, workspaceId } = await endpoint.client.importEnterpriseSnapshot(endpoint.workspaceId, snapshot, current.model ?? undefined, current.engineId);
        if (!alive.current) return;
        try { await enterpriseApi.messageAction(current.connection, message.id, "accept"); }
        catch { toast.warning("会话已创建，接收回执尚未同步。再次接收会打开已有会话。"); }
        if (!alive.current) return;
        current.onImported(workspaceId, item.id);
        toast.success("已接收总结并创建独立会话");
      })().catch((cause: unknown) => {
        if (!alive.current) return;
        const message = cause instanceof Error ? cause.message : "";
        setImportError(message.includes("enterprise_import_pending") ? "上次创建结果尚未确认，请先检查已有会话，避免重复创建。" : message === "enterprise_context_mismatch" ? "请先在当前企业中选择一个本地项目，再接收分享。" : message === "enterprise_share_unavailable" ? "这条分享已撤回或暂不可领取。" : enterpriseErrorMessage(cause));
      }).finally(() => { importingRef.current = false; if (alive.current) setImporting(false); });
    };
    window.addEventListener(enterpriseShareSessionEvent, share);
    window.addEventListener(enterpriseImportMessageEvent, receive);
    receive();
    return () => { alive.current = false; window.removeEventListener(enterpriseShareSessionEvent, share); window.removeEventListener(enterpriseImportMessageEvent, receive); };
  }, []);
  const send = async () => {
    if (!target || !selected.memberIds.length || busy) return;
    const endpoint = resolveWorkspace(target.workspaceId);
    if (!endpoint) return;
    setError(null); setBusy(summary ? "正在发送分享" : "正在生成会话总结");
    try {
      let content = summary;
      if (!content) {
        const result = await endpoint.client.summarizeSessionForEnterprise(endpoint.workspaceId, target.sessionId, model ?? undefined);
        content = enterpriseSummarySchema.parse(result.item);
        if (!alive.current) return;
        setSummary(content);
        if (preview) return;
      }
      if (!alive.current) return;
      setBusy("正在发送分享");
      await enterpriseApi.share(connection, { idempotencyKey: key.current, title: content.title, markdown: content.markdown, sourceSessionId: target.sessionId, recipientIds: selected.memberIds });
      if (alive.current) { setTarget(null); toast.success(`已分享给 ${selected.memberIds.length} 位企业成员`); }
    } catch (cause) { if (alive.current) setError(enterpriseErrorMessage(cause)); }
    finally { if (alive.current) setBusy(null); }
  };
  return <>
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !busy) setTarget(null); }}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto" data-testid="enterprise-session-share"><DialogHeader><DialogTitle>分享会话总结</DialogTitle><DialogDescription>{connection.name} · 接收方会创建独立会话，双方后续各自继续</DialogDescription></DialogHeader>
      <EnterprisePeoplePicker connection={connection} disabled={Boolean(busy)} value={selected} onChange={(value) => { setSelected(value); key.current = crypto.randomUUID(); }} />
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={preview} disabled={Boolean(busy) || Boolean(summary)} onCheckedChange={setPreview} />发送前预览和编辑总结</label>
      {summary ? <div className="space-y-3"><label className="block space-y-1.5"><span className="text-xs font-medium">分享标题</span><Input value={summary.title} maxLength={500} disabled={Boolean(busy)} onChange={(event) => { setSummary({ ...summary, title: event.target.value }); key.current = crypto.randomUUID(); }} /></label><label className="block space-y-1.5"><span className="text-xs font-medium">Markdown 总结</span><Textarea className="min-h-48" value={summary.markdown} maxLength={100_000} disabled={Boolean(busy)} onChange={(event) => { setSummary({ ...summary, markdown: event.target.value }); key.current = crypto.randomUUID(); }} /></label>{summary.truncated ? <p className="text-xs text-muted-foreground">会话较长，本次总结仅覆盖已读取且在长度范围内的已完成消息。</p> : null}</div> : null}
      {error ? <div className="space-y-2"><p role="alert" className="rounded-lg bg-feedback-error p-3 text-sm text-red-11">{error}</p>{!summary ? <Button variant="outline" size="sm" onClick={() => { setSummary({ title: "会话总结", markdown: "", messageCount: 0, truncated: false }); setError(null); key.current = crypto.randomUUID(); }}>手动填写总结</Button> : null}</div> : null}
      {busy ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{busy}</p> : null}
      <p className="text-xs text-muted-foreground">分享总结正文。源电脑上的文件、账号凭据和插件授权不会随总结传输。</p>
      <DialogFooter><Button variant="outline" disabled={Boolean(busy)} onClick={() => setTarget(null)}>取消</Button><Button disabled={Boolean(busy) || !selected.memberIds.length || (!summary && !model) || Boolean(summary && (!summary.title.trim() || !summary.markdown.trim()))} onClick={() => void send()}><Share2 className="size-4" />{summary ? "确认发送" : preview ? "生成总结并预览" : "确定并分享"}</Button></DialogFooter>
      {!model && !summary ? <p className="text-xs text-muted-foreground">请先为当前项目选择一个已连接的模型。</p> : null}
    </DialogContent></Dialog>
    <Dialog open={importing || Boolean(importError)} onOpenChange={(open) => { if (!open && !importing) setImportError(null); }}><DialogContent><DialogHeader><DialogTitle>接收会话分享</DialogTitle><DialogDescription>保存总结快照并创建独立会话</DialogDescription></DialogHeader>{importing ? <p role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />正在接收分享</p> : <p role="alert">{importError}</p>}</DialogContent></Dialog>
  </>;
}

export function EnterpriseSnapshotNotice({ client, workspaceId, sessionId, connection }: { client: iPolloWorkServerClient; workspaceId: string; sessionId: string; connection: EnterpriseConnection }) {
  const [snapshot, setSnapshot] = useState<EnterpriseSnapshot | null>(null);
  useEffect(() => {
    let current = true; setSnapshot(null);
    void client.getEnterpriseSnapshot(workspaceId, sessionId).then((result) => { if (current) { const parsed = enterpriseSnapshotSchema.safeParse(result.snapshot); setSnapshot(parsed.success && parsed.data.enterpriseId === connection.id && parsed.data.memberId === connection.membership.id ? parsed.data : null); } }).catch(() => { /* Older local services have no imported snapshots. */ });
    return () => { current = false; };
  }, [client, workspaceId, sessionId, connection.id, connection.membership.id]);
  if (!snapshot) return null;
  return <details data-testid="enterprise-snapshot-context" className="mx-4 my-2 shrink-0 rounded-lg border border-border bg-muted/30 px-3 py-2"><summary className="cursor-pointer text-xs font-medium">来自 {snapshot.senderName} 的总结快照 · 点击查看</summary><p className="my-2 text-xs text-muted-foreground">接收后独立继续；首次提问时会将此总结作为参考资料提供给模型。</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6">{snapshot.markdown}</pre></details>;
}
