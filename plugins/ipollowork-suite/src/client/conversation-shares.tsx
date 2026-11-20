import { useEffect, useState } from "react";
import { Button, IconShareOutlineRegular, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { SharedMessage } from "../shared/enterprise.ts";
import type { Props } from "./enterprise.tsx";
import type { EnterpriseLabels } from "./enterprise-locale.ts";
import type { AssetProps } from "./enterprise-assets.tsx";
import { DirectoryStatus, EmptyState, Field, FormError, ListSkeleton, Notice, Row, Section, Transcript, When, useMemberDirectory, useRecord, useTask } from "./enterprise-ui.tsx";
import styles from "./suite.module.css";
import trigger from "./sharing/ShareAction.module.css";

type ActionProps = Props & PropsRuntime<"conversation.session.header.utilities">;
type Preview = { revision: string; messageCount: number };
type Shares = { userId: string; items: { id:string; title:string; ownerId:string; ownerName:string; createdAt:number }[] };

export function ConversationShareAction({ sessionId, useSessions, useEnterpriseState, useEnterpriseLabels, useLocale, controller, openAccountSettings }: ActionProps) {
  const zh = useLocale(value => value).startsWith("zh");
  const title = useSessions(state => state.byId[sessionId]?.displayTitle) || (zh ? "新会话" : "Conversation");
  const t = useEnterpriseLabels(value => value), state = useEnterpriseState(value => value);
  const [open, setOpen] = useState(false), [organization, setOrganization] = useState("");
  const [preview, setPreview] = useState<Preview>(), [failure, setFailure] = useState("");
  const [requestId, setRequestId] = useState("");
  useEffect(() => {
    if (!open || !state.signedIn) return;
    let active = true;
    setPreview(undefined); setFailure("");
    void controller.call<Preview>("/conversation-share-preview", { sessionId }).then(
      result => { if (active) setPreview(result); },
      (error: unknown) => { if (active) setFailure(error instanceof Error ? error.message : "IPW_ACCOUNT_UNAVAILABLE"); },
    );
    return () => { active = false; };
  }, [open, sessionId, state.signedIn, controller]);
  const organizations = state.catalog?.enterprises ?? [];
  const selected = organization || state.enterpriseId || organizations[0]?.id;
  const label = zh ? "分享" : "Share";
  return <>
    <button type="button" className={trigger.trigger} aria-label={label} onClick={() => {
      setOrganization("");
      setRequestId(crypto.randomUUID());
      setOpen(true);
      if (state.signedIn && !state.catalog && !state.loading) void controller.load();
    }}><span>{label}</span><IconShareOutlineRegular size={12}/></button>
    {open && <Modal open title={zh ? "分享给组织成员" : "Share with organization members"} closeLabel={t.close} className={styles.enterpriseModal!} onClose={() => setOpen(false)}>
      <div className={styles.enterpriseStack}>
        <p className={styles.muted}>{zh ? "对方可以在软件内复制并继续对话。仅分享可见文字，不包含附件、工具记录或工作区文件。"
          : "Recipients can copy and continue this chat in the app. Only visible text is shared, without attachments, tool history or workspace files."}</p>
        {!state.signedIn ? <Button onClick={openAccountSettings}>{zh ? "先登录组织账户" : "Sign in to your organization account"}</Button> :
          state.error && !state.catalog ? <Notice error={state.error} t={t} fallback={t.organizationListLoadFailed} retry={controller.load}/> :
          !state.catalog ? <ListSkeleton rows={2}/> :
          !selected ? <EmptyState title={zh ? "先加入企业才能分享" : "Join an organization to share"}/> :
          <>
            {organizations.length > 1 && <Field label={zh ? "组织" : "Organization"}><select value={selected} onChange={event => setOrganization(event.currentTarget.value)}>
              {organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></Field>}
            <Notice error={failure} t={t}/>
            {!failure && <RecipientSelection key={selected} enterpriseId={selected} requestId={requestId} sessionId={sessionId} title={title}
              preview={preview} controller={controller} userId={state.catalog.userId} t={t} zh={zh} onClose={() => setOpen(false)}/>}
          </>}
      </div>
    </Modal>}
  </>;
}

function RecipientSelection({ enterpriseId, requestId, sessionId, title, preview, controller, userId, t, zh, onClose }: {
  enterpriseId: string; requestId: string; sessionId: string; title: string; preview: Preview | undefined;
  controller: Props["controller"]; userId: string; t: EnterpriseLabels; zh: boolean; onClose(): void;
}) {
  const path = "/organizations/" + enterpriseId;
  const [selected, setSelected] = useState<string[]>([]), [query, setQuery] = useState("");
  const directory = useMemberDirectory(enterpriseId, controller.call, 0, { query, active: true });
  const task = useTask(t);
  const members = directory.data?.items.filter(member => member.userId !== userId) ?? [];
  return <form className={styles.enterpriseStack} onSubmit={event => {
    event.preventDefault();
    if (!preview || !selected.length) return;
    void task.run(async () => {
      await controller.call(path + "/messages", { requestId, sessionId, title: title.trim().slice(0,120), recipients: selected, revision: preview.revision });
      controller.notify(zh ? "已分享给选中的成员" : "Shared with selected members");
      onClose();
    });
  }}>
    <Field label={zh ? "选择成员" : "Select members"}>
      <input type="search" maxLength={120} value={query} onChange={event=>setQuery(event.currentTarget.value)} placeholder={zh ? "搜索姓名或工号" : "Search name or employee number"}/>
    </Field>
    <div className={styles.shareMembers} role="group" aria-label={zh ? "组织成员" : "Organization members"}>
      {members.map(member => (
        <label key={member.userId}><input type="checkbox" checked={selected.includes(member.userId)} onChange={event => {
          setSelected(ids => event.target.checked ? [...ids,member.userId] : ids.filter(id=>id!==member.userId));
        }}/><span>{member.name}{member.employeeNumber ? <small>{member.employeeNumber}</small> : null}</span></label>
      ))}
    </div>
    {directory.data && !members.length && <p>{t.noMembersMatch}</p>}
    <DirectoryStatus directory={directory} t={t}/>
    <FormError message={task.error}/>
    <div className={styles.dialogFooter}>
      <span className={styles.muted}>{zh ? `已选 ${selected.length} 人` : `${selected.length} selected`}</span>
      <Button type="submit" variant="primary" disabled={!selected.length || selected.length > 100 || !preview || task.busy}>
        {zh ? "分享会话" : "Share conversation"}
      </Button>
    </div>
  </form>;
}

export function OrganizationMessages({ enterpriseId, call, revision, controller, t, language, openSession, target }: AssetProps & { openSession(id: string): Promise<void>; target?: string | undefined }) {
  const path = "/organizations/" + enterpriseId + "/messages";
  const state = useRecord<Shares>(path,call,revision);
  const [selected, setSelected] = useState(target);
  useEffect(() => { setSelected(target); }, [target]);
  const zh = language.startsWith("zh"), task = useTask(t);
  return <Section title={t.messagesTab} actions={<Button size="sm" variant="outline" onClick={state.reload}>{t.refresh}</Button>}>
    <Notice error={state.error} t={t} retry={state.reload}/>
    <FormError message={task.error}/>
    {!state.data ? (!state.error && <ListSkeleton/>) : state.data.items.length ? state.data.items.map(row => {
      const own = row.ownerId === state.data?.userId;
      return <Row key={row.id} title={row.title} onOpen={() => setSelected(row.id)} meta={own ? (zh ? "我分享的" : "Shared by me") : row.ownerName}
        aside={<When at={row.createdAt} language={language}/>} actions={own ?
          <Button size="sm" variant="ghost" disabled={task.busy} onClick={() => controller.open({
            kind:"confirm", title:zh ? "撤回分享" : "Withdraw share",
            description:zh ? "撤回后，成员无法再复制。已经保存的副本会保留。" : "Members cannot copy it again after withdrawal. Existing copies remain.",
            confirmLabel:zh ? "撤回" : "Withdraw",
            run:async()=>{await call(path + "/" + row.id, undefined, "DELETE"); state.reload();},
          })}>{zh ? "撤回" : "Withdraw"}</Button> :
          <Button size="sm" variant="primary" disabled={task.busy} onClick={()=>void task.run(async()=>{
            const result = await call<{sessionId:string}>(path + "/" + row.id + "/copy", {});
            await openSession(result.sessionId);
          })}>{zh ? "复制并打开" : "Copy and open"}</Button>}/>;
    }) : <EmptyState title={zh ? "暂无共享会话" : "No shared conversations"}
      hint={zh ? "打开任意会话，点击右上角的分享按钮。" : "Open a chat and choose Share in the header."}/>}
    {selected && <SharedConversationDetail key={selected} path={path + "/" + selected} call={call} revision={revision}
      openSession={openSession} t={t} zh={zh} close={() => { controller.clearNoticeTarget(); setSelected(undefined); }}/>}
  </Section>;
}

function SharedConversationDetail({ path, call, revision, openSession, t, zh, close }: {
  path: string; call: AssetProps["call"]; revision: number; openSession(id: string): Promise<void>;
  t: EnterpriseLabels; zh: boolean; close(): void;
}) {
  const record = useRecord<{ title: string; transcript: SharedMessage[] }>(path, call, revision);
  const task = useTask(t);
  return <Modal open title={record.data?.title ?? t.messagesTab} closeLabel={t.close} className={styles.enterpriseModal!} onClose={close}>
    <Notice error={record.error} t={t} retry={record.reload}/>
    {!record.data && !record.error && <ListSkeleton rows={2}/>}
    {record.data && <>
      <Transcript messages={record.data.transcript} t={t}/>
      <FormError message={task.error}/>
      <div className={styles.dialogFooter}>
        <Button variant="primary" disabled={task.busy} onClick={() => void task.run(async () => {
          const {sessionId} = await call<{sessionId:string}>(path + "/copy", {});
          await openSession(sessionId);
          close();
        })}>{zh ? "复制并打开" : "Copy and open"}</Button>
      </div>
    </>}
  </Modal>;
}
