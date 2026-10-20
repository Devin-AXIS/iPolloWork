import { useEffect, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import type { EnterpriseMessage } from "@ipollowork/types/enterprise";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { enterpriseApi, enterpriseErrorMessage, enterpriseIdentity, requestEnterpriseMessageImport } from "@/app/lib/enterprise-client";

export function useEnterpriseMessages(connection: EnterpriseConnection | null) {
  const identity = connection ? enterpriseIdentity(connection) : "";
  const [state, setState] = useState<{ identity: string; items: EnterpriseMessage[]; cursor: string | null }>({ identity: "", items: [], cursor: null });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const options = useRef(connection); options.current = connection;
  useEffect(() => {
    if (!connection?.features?.messaging) { setState({ identity, items: [], cursor: null }); setError(null); setLoading(false); return; }
    let current = true;
    let inFlight = false;
    let retryDelay = 30_000;
    let timer: number | undefined;
    const poll = async () => {
      if (!current || inFlight || !options.current) return;
      inFlight = true; setLoading(true);
      const controller = new AbortController(); request.current = controller;
      try {
        const page = await enterpriseApi.messages(options.current, null, controller.signal);
        if (!current) return;
        setState((previous) => {
          const updated = new Map(page.items.map((message) => [message.id, message]));
          const old = previous.identity === identity ? previous.items : [];
          return { identity, items: [...page.items, ...old.filter((message) => !updated.has(message.id))].slice(0, 500), cursor: previous.identity === identity && old.length > 50 ? previous.cursor : page.nextCursor };
        });
        setError(null); retryDelay = 30_000;
      } catch (cause) { if (current && !controller.signal.aborted) { setError(enterpriseErrorMessage(cause)); retryDelay = Math.min(retryDelay * 2, 300_000); } }
      finally { inFlight = false; if (current) { setLoading(false); timer = window.setTimeout(() => void poll(), retryDelay); } }
    };
    const focus = () => { if (timer) window.clearTimeout(timer); void poll(); };
    window.addEventListener("focus", focus); void poll();
    return () => { current = false; request.current?.abort(); if (timer) window.clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, [identity, connection?.features?.messaging, revision]);
  const more = async () => {
    if (!options.current || state.identity !== identity || !state.cursor || loading) return;
    const snapshotIdentity = identity;
    setLoading(true); setError(null);
    try {
      const page = await enterpriseApi.messages(options.current, state.cursor);
      if (!options.current || enterpriseIdentity(options.current) !== snapshotIdentity) return;
      setState((previous) => ({ identity, items: [...new Map([...previous.items, ...page.items].map((message) => [message.id, message])).values()].slice(0, 500), cursor: page.nextCursor === state.cursor ? null : page.nextCursor }));
    } catch (cause) { if (options.current && enterpriseIdentity(options.current) === snapshotIdentity) setError(enterpriseErrorMessage(cause)); }
    finally { if (options.current && enterpriseIdentity(options.current) === snapshotIdentity) setLoading(false); }
  };
  const items = state.identity === identity ? state.items : [];
  return { items, cursor: state.identity === identity ? state.cursor : null, error, loading, refresh: () => setRevision((value) => value + 1), more, unread: items.filter((item) => !item.readAt && !item.ignoredAt && !item.revokedAt).length };
}

export function EnterpriseMessageList({ connection, inbox, onExit }: {
  connection: EnterpriseConnection; inbox: ReturnType<typeof useEnterpriseMessages>; onExit: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [selected, setSelected] = useState<EnterpriseMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const open = async (message: EnterpriseMessage) => {
    setBusy(true); setError(null);
    try {
      const current = await enterpriseApi.message(connection, message.id);
      if (!active.current) return;
      setSelected(current);
      if (!current.readAt) await enterpriseApi.messageAction(connection, current.id, "read");
      if (active.current) inbox.refresh();
    } catch (cause) { if (active.current) setError(enterpriseErrorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  };
  const ignore = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try { await enterpriseApi.messageAction(connection, selected.id, "ignore"); if (active.current) { setSelected(null); inbox.refresh(); } }
    catch (cause) { if (active.current) setError(enterpriseErrorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  };
  return <div data-testid="enterprise-inbox" className="max-h-80 overflow-y-auto border-b border-border pb-2">
    <div className="flex items-center gap-2 px-4 py-2"><Mail className="size-3.5" /><p className="min-w-0 flex-1 truncate text-xs font-medium">{connection.shortName} · 企业消息</p><Button variant="ghost" size="icon-sm" disabled={inbox.loading} aria-label="刷新企业消息" onClick={inbox.refresh}><RefreshCw className="size-3.5" /></Button></div>
    {!connection.features?.messaging ? <p className="px-4 py-2 text-xs text-muted-foreground">当前企业服务尚未开放企业消息。</p> : <>
      {inbox.error || error ? <p role="alert" className="mx-3 rounded-lg bg-feedback-error p-2 text-xs text-red-11">{error || inbox.error}</p> : null}
      {inbox.items.map((message) => <button key={message.id} type="button" disabled={busy} className="block w-full px-4 py-3 text-left hover:bg-muted disabled:opacity-50" onClick={() => void open(message)}><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{message.title}</span>{!message.readAt ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{message.senderName} · {message.revokedAt ? "已撤回" : message.acceptedAt ? "已接收" : message.ignoredAt ? "已忽略" : message.kind === "session_share" ? "会话分享" : message.kind === "resource_granted" ? "资源授权" : "企业通知"}</span></button>)}
      {inbox.loading && !inbox.items.length ? <p role="status" className="px-4 py-3 text-xs text-muted-foreground">正在加载企业消息</p> : !inbox.items.length && !inbox.error ? <p className="px-4 py-3 text-xs text-muted-foreground">暂无企业消息</p> : null}
      {inbox.cursor && inbox.items.length < 500 ? <Button variant="ghost" size="sm" disabled={inbox.loading} onClick={() => void inbox.more()}>加载更多消息</Button> : null}
    </>}
    <Dialog open={Boolean(selected)} onOpenChange={(value) => { if (!value && !busy) setSelected(null); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" data-testid="enterprise-message-preview"><DialogHeader><DialogTitle>{selected?.title}</DialogTitle><DialogDescription>{selected?.senderName} · {connection.name}</DialogDescription></DialogHeader>
      {selected?.markdown ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm leading-7">{selected.markdown}</pre> : <p className="text-sm text-muted-foreground">{selected?.kind === "session_share" ? selected.revokedAt ? "这条分享已撤回，企业端已清理总结正文。" : selected.acceptedAt ? "总结已保存到接收设备，企业端不再向你提供正文。可在原设备打开已保存的会话。" : selected.ignoredAt ? "这条分享已忽略，不再领取总结。" : "这条分享暂不可领取。" : selected?.kind === "resource_granted" ? "你可以在当前企业的资源入口中查看已授权资源。" : "企业通知"}</p>}
      {error ? <p role="alert" className="text-sm text-red-11">{error}</p> : null}
      <DialogFooter><Button variant="outline" disabled={busy || Boolean(selected?.revokedAt || selected?.acceptedAt || selected?.ignoredAt)} onClick={() => void ignore()}>忽略</Button>{selected?.kind === "session_share" ? <Button disabled={busy || Boolean(selected.revokedAt || selected.ignoredAt) || (!selected.markdown && !selected.acceptedAt)} onClick={() => { requestEnterpriseMessageImport(connection, selected.id); setSelected(null); onExit(); if (!matchPath("/session/:sessionId?", pathname) && !matchPath("/workspace/:workspaceId/session/:sessionId?", pathname)) navigate("/session"); }}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}{selected.acceptedAt ? "在本机打开分享会话" : "接收并新建会话"}</Button> : selected?.resourceType ? <Button disabled={busy} onClick={() => { const path = selected.resourceType === "template" ? `/session?enterpriseTemplates=${encodeURIComponent(connection.id)}` : selected.resourceType === "skill" ? "/settings/extensions/skills?source=enterprise" : "/settings/extensions/plugins"; setSelected(null); onExit(); navigate(path); }}>查看资源</Button> : <Button disabled={busy} onClick={() => setSelected(null)}>关闭</Button>}</DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
