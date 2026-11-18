import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MemberNotice, OrganizationActivity, OrganizationPublication, PublicationKind, PublicationVersion } from "../shared/enterprise.ts";
import { AccessDialog, AudiencePill, type AssetProps } from "./enterprise-assets.tsx";
import { EmptyState, Field, FormError, ListSkeleton, Notice, Row, Section, When, roleName, useRecord, useTask, type Call } from "./enterprise-ui.tsx";
import type { EnterpriseController, EnterpriseState } from "./enterprise-controller.ts";
import { format, type EnterpriseLabels } from "./enterprise-locale.ts";
import { BellGlyph } from "./glyphs.tsx";
import css from "./suite.module.css";

type PublicationProps = AssetProps & { kind: PublicationKind; install(spec: string): Promise<void>; target?: string | undefined };

export function OrganizationPublications(props: PublicationProps) {
  const { enterpriseId, call, revision, language, t, kind } = props;
  const path = "/organizations/" + enterpriseId + "/publications/" + kind;
  const list = useRecord<{ items: OrganizationPublication[]; canManage: boolean }>(path, call, revision);
  const [selected, setSelected] = useState<string | undefined>(props.target);
  useEffect(() => { if (props.target) setSelected(props.target); }, [props.target]);
  const [editing, setEditing] = useState<OrganizationPublication | "new">();
  const zh = language.startsWith("zh");
  const current = list.data?.items.find(item => item.id === selected);
  if (!list.data) return list.error ? <Notice error={list.error} t={t} retry={list.reload}/> : <ListSkeleton/>;
  const items = kind === "mcp" && !list.data.canManage ? list.data.items.filter(item => item.canSubmit) : list.data.items;
  return <Section
    title={kind === "plugin" ? t.pluginsTab : kind === "skill" ? t.skillPublications :
      kind === "mcp" ? (list.data.canManage ? (zh ? "MCP 提交与审核" : "MCP review") :
        (zh ? "我的 MCP 提交" : "My MCP submissions")) : t.templatesTab}
    actions={<Button variant="primary" onClick={() => setEditing("new")}>{
      kind === "mcp" ? (zh ? "提交 MCP" : "Submit MCP") : (zh ? "提交资源" : "Submit resource")
    }</Button>}
  >
    <Notice error={list.error} t={t} retry={list.reload}/>
    {items.length ? items.map(item => (
      <div key={item.id}>
        <Row title={item.title} meta={item.packageName
          ? [item.packageName, item.publishedVersion].filter(Boolean).join(" · ")
          : [item.description, item.publishedVersion].filter(Boolean).join(" · ")}
          onOpen={() => setSelected(selected === item.id ? undefined : item.id)}/>
        {current?.id === item.id && <PublicationDetails
          {...props} publication={item} path={path + "/" + item.id}
          edit={() => setEditing(item)} canManage={list.data!.canManage}
        />}
      </div>
    )) : <EmptyState title={zh ? "暂无共享资源" : "No shared resources yet"}/>}
    {editing && <PublicationForm {...props} publication={editing === "new" ? undefined : editing}
      path={path} close={() => setEditing(undefined)}/>}
  </Section>;
}

function PublicationForm({ publication, path, close, kind, language, t, call, controller }: PublicationProps & {
  publication: OrganizationPublication | undefined; path: string; close(): void;
}) {
  const [fileError, setFileError] = useState("");
  const [html, setHtml] = useState("");
  const task = useTask(t);
  const zh = language.startsWith("zh");
  return <Modal open title={publication ? (zh ? "提交新版本" : "Submit a new version") : (zh ? "提交资源" : "Submit resource")}
    closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close(); }}>
    <form className={css.enterpriseForm} onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void task.run(async () => {
        await call(path, {
          ...(publication ? {id:publication.id} : {}),
          title: form.get("title"), description: form.get("description"), version: form.get("version"),
          ...(kind === "plugin" ? { packageName: form.get("packageName") } : kind === "skill" ? {markdown:form.get("markdown")} :
            kind === "mcp" ? {endpoint: form.get("endpoint")} : { html }),
        });
        close();
        await controller.load();
      });
    }}>
      <Field label={t.name}><input name="title" maxLength={120} required defaultValue={publication?.title}/></Field>
      <Field label={zh ? "说明" : "Description"}><textarea name="description" maxLength={kind === "skill" ? 1000 : 2000}
        required={kind === "skill"} rows={2} defaultValue={publication?.description}/></Field>
      {kind === "plugin" ? <Field label={zh ? "DSH 插件包名" : "DSH plugin package"}>
        <input name="packageName" required maxLength={214} placeholder="@team/plugin" readOnly={!!publication} defaultValue={publication?.packageName}/>
      </Field> : kind === "skill" ? <Field label="SKILL.md"><textarea name="markdown" rows={8} maxLength={32000} required/></Field>
        : kind === "mcp" ? <Field label={t.mcpEndpoint} hint={t.mcpEndpointHint}>
          <input name="endpoint" type="url" maxLength={2048} required />
        </Field>
        : <Field label={zh ? "HTML 模板" : "HTML template"}>
        <input type="file" accept=".html,.htm,text/html" required onChange={event => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          setHtml("");
          setFileError("");
          if (!file) return;
          if (file.size > 110 * 1024) {
            setFileError(zh ? "HTML 文件不能超过 110 KB" : "Use an HTML file up to 110 KB");
            return;
          }
          void file.text().then(content => {
            if (input.files?.[0] !== file) return;
            if (new TextEncoder().encode(JSON.stringify(content)).length > 235 * 1024)
              setFileError(zh ? "模板内容过大" : "The template content is too large");
            else setHtml(content);
          }, () => {
            if (input.files?.[0] === file) setFileError(zh ? "无法读取模板" : "Could not read the template");
          });
        }}/>
      </Field>}
      <Field label={zh ? "版本" : "Version"}><input name="version" placeholder="1.0.0" maxLength={64} required/></Field>
      <FormError message={fileError || task.error}/>
      <div className={css.dialogFooter}>
        <Button type="button" variant="outline" disabled={task.busy} onClick={close}>{t.cancel}</Button>
        <Button type="submit" variant="primary" disabled={task.busy || (kind === "template" && !html.trim())}>{zh ? "提交审核" : "Submit for review"}</Button>
      </div>
    </form>
  </Modal>;
}

function PublicationDetails(props: PublicationProps & {
  publication: OrganizationPublication; path: string; canManage: boolean; edit(): void;
}) {
  const { publication, call, revision, t, path, kind, language, controller, canManage } = props;
  const versions = useRecord<{ items: PublicationVersion[] }>(path + "/versions", call, revision);
  const [access, setAccess] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [review, setReview] = useState<{ version: string; decision: "approve" | "reject" }>();
  const task = useTask(t);
  const zh = language.startsWith("zh");
  const release = (version: string) => path + "/versions/" + encodeURIComponent(version);
  const read = (version: string) => void task.run(async () => {
    if (kind === "plugin") {
      const { spec } = await call<{spec:string}>(release(version));
      await props.install(spec);
    } else if (kind === "template") {
      const { html } = await call<{html:string}>(release(version));
      setPreview(html);
    } else if (kind === "mcp") {
      const { endpoint } = await call<{endpoint:string}>(release(version));
      setPreview(endpoint);
    } else {
      const { markdown } = await call<{markdown:string}>(release(version));
      setPreview(markdown);
    }
  });
  const publish = (version: string) => void task.run(async () => {
    await call(release(version), { decision: "publish" }, "PUT");
    await controller.load();
  });
  return <div className={css.enterpriseForm}>
    {publication.description && kind === "plugin" && <p>{publication.description}</p>}
    <div className={css.enterpriseActions}>
      {publication.canSubmit && <Button size="sm" variant="outline" onClick={props.edit}>{zh ? "提交新版本" : "Submit a new version"}</Button>}
      {canManage && publication.audience && <AudiencePill audience={publication.audience} t={t}
        detail={props.detail} onEdit={() => setAccess(true)}/>}
      {canManage && publication.publishedVersion && <Button size="sm" variant="ghost" disabled={task.busy}
        onClick={() => controller.open({ kind:"confirm", title:zh ? "下架资源" : "Unpublish resource",
          description:zh ? "已提交的版本会保留，组织成员将无法获取此资源。" : "Versions stay in history. Members lose access to the publication.",
          confirmLabel:zh ? "下架" : "Unpublish", run: async () => { await call(path, undefined, "DELETE"); await controller.load(); } })}>
        {zh ? "下架" : "Unpublish"}
      </Button>}
    </div>
    <FormError message={task.error}/>
    {versions.error ? <Notice error={versions.error} t={t} retry={versions.reload}/> : !versions.data ? <ListSkeleton/> :
      versions.data.items.map(row => {
        const published = row.version === publication.publishedVersion;
        const status = published ? (zh ? "已发布" : "Published") : {
          pending: zh ? "待审核" : "Pending review", approved: zh ? "已通过" : "Approved", rejected: zh ? "已驳回" : "Rejected",
        }[row.status];
        return <Row key={row.version} title={row.version} meta={[status,row.note].filter(Boolean).join(" · ")} actions={<>
          {(published || kind !== "plugin") && <Button size="sm" variant="outline" disabled={task.busy} onClick={() => read(row.version)}>
            {kind === "plugin" ? (zh ? "用 DSH 安装" : "Install with DSH") : (zh ? "预览" : "Preview")}
          </Button>}
          {canManage && !published && row.status === "approved" && <Button size="sm" variant="primary" disabled={task.busy} onClick={() => publish(row.version)}>{zh ? "下发" : "Publish"}</Button>}
          {canManage && !published && row.status === "pending" && <>
            <Button size="sm" variant="outline" onClick={() => setReview({version:row.version,decision:"approve"})}>{zh ? "通过" : "Approve"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setReview({version:row.version,decision:"reject"})}>{zh ? "驳回" : "Reject"}</Button>
          </>}
        </>}/>;
      })}
    {access && publication.audience && <AccessDialog {...props} kind={kind} assetId={publication.id}
      title={publication.title} audience={publication.audience} close={() => setAccess(false)}/>}
    {review && <Modal open title={zh ? "版本审核" : "Review version"} closeLabel={t.close} onClose={() => { if (!task.busy) setReview(undefined); }}>
      <form className={css.enterpriseForm} onSubmit={event => {
        event.preventDefault();
        const note = new FormData(event.currentTarget).get("note");
        void task.run(async () => {
          await call(release(review.version), { decision: review.decision, note }, "PUT");
          setReview(undefined);
          await controller.load();
        });
      }}>
        <Field label={zh ? "审核说明" : "Review note"}><textarea name="note" rows={3} maxLength={1000}/></Field>
        <FormError message={task.error}/>
        <div className={css.dialogFooter}><Button type="submit" variant="primary" disabled={task.busy}>
          {review.decision === "approve" ? (zh ? "通过" : "Approve") : (zh ? "驳回" : "Reject")}
        </Button></div>
      </form>
    </Modal>}
    {preview !== undefined && <Modal open title={publication.title} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => setPreview(undefined)}>
      {kind !== "template" ? <pre className={css.organizationSkillPreview}>{preview}</pre> : <iframe title={publication.title} className={css.organizationTemplatePreview} sandbox="" referrerPolicy="no-referrer" srcDoc={
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">" + preview
      }/>}
      {kind !== "mcp" && <Button variant="outline" onClick={() => {
        const url = URL.createObjectURL(new Blob([preview], {type:kind === "skill" ? "text/markdown" : "text/html"}));
        const link = document.createElement("a");
        link.href = url;
        link.download = kind === "skill" ? "SKILL.md" : "template.html";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>{kind === "skill" ? (zh ? "下载 Skill" : "Download Skill") : (zh ? "下载 HTML" : "Download HTML")}</Button>}
    </Modal>}
  </div>;
}

const activityNames: Record<string, [string, string]> = {
  "enterprise.create": ["创建组织", "Created organization"],
  "enterprise.update": ["更新组织设置", "Updated organization settings"],
  "department.create": ["创建部门", "Created department"],
  "department.update": ["更新部门", "Updated department"],
  "department.remove": ["移除部门", "Removed department"],
  "invitation.create": ["生成邀请", "Created invitation"],
  "invitation.accept": ["加入组织", "Joined organization"],
  "invitation.revoke": ["撤销邀请", "Revoked invitation"],
  "member.update": ["更新成员", "Updated member"],
  "member.remove": ["移除成员", "Removed member"],
  "publication.submit": ["提交资源版本", "Submitted resource version"],
  "publication.approve": ["通过审核", "Approved resource version"],
  "publication.reject": ["驳回审核", "Rejected resource version"],
  "publication.publish": ["发布资源", "Published resource"],
  "publication.archive": ["下架资源", "Unpublished resource"],
  "grant.update": ["更新资源访问范围", "Updated resource access"],
  "organization.notification.configure": ["更新成员变更通知", "Updated membership notifications"],
  "skill.create": ["发布技能", "Published skill"],
  "skill.remove": ["移除技能", "Removed skill"],
  "mcp.create": ["添加 MCP", "Added MCP"],
  "mcp.update": ["更新 MCP", "Updated MCP"],
  "mcp.remove": ["移除 MCP", "Removed MCP"],
  "conversation.share": ["分享会话", "Shared conversation"],
  "conversation.revoke": ["撤回会话分享", "Withdrew shared conversation"],
  "project.submit": ["提交项目改动", "Submitted project changes"],
  "project.accept": ["接纳项目改动", "Accepted project changes"],
};

export function OrganizationActivityTab({ enterpriseId, call, revision, t, language }: AssetProps) {
  const zh = language.startsWith("zh");
  const [search, setSearch] = useState(""), [actor, setActor] = useState("");
  const filtered = useMemo<Call>(() => path => actor ? call(path, {actor}, "POST") : call(path), [call, actor]);
  const state = useRecord<{items:OrganizationActivity[]}>("/organizations/" + enterpriseId + "/activity", filtered, revision);
  return <Section title={t.activityTab} actions={
    <form className={css.activitySearch} onSubmit={event=>{event.preventDefault(); setActor(search.trim());}}>
      <input type="search" aria-label={zh ? "操作人" : "Operator"} maxLength={120} value={search}
        placeholder={zh ? "姓名或工号" : "Name or employee number"}
        onChange={event=>{setSearch(event.currentTarget.value); if (!event.currentTarget.value) setActor("");}}/>
      <Button type="submit" size="sm" variant="outline">{zh ? "搜索" : "Search"}</Button>
    </form>
  }>
    <Notice error={state.error} t={t} retry={state.reload}/>
    {!state.data ? (!state.error && <ListSkeleton/>) : state.data.items.length ? state.data.items.map(row => (
      <Row key={row.id} title={activityNames[row.action]?.[zh ? 0 : 1] ?? (zh ? "更新组织" : "Updated organization")}
        meta={row.actor} aside={<When at={row.createdAt} language={language}/>}/>
    )) : <EmptyState title={actor ? (zh ? "没有匹配该操作人的记录" : "No activity for this operator")
      : (zh ? "暂无操作记录" : "No organization activity yet")}/>}
  </Section>;
}

function noticeMessage(row: MemberNotice, t: EnterpriseLabels, zh: boolean): string {
  const event = {
    "resource.approved": ["审核通过", "Approved"],
    "resource.rejected": ["审核未通过", "Rejected"],
    "resource.published": ["资源已下发", "Resource published"],
    "project.submitted": ["收到项目改动", "Project changes submitted"],
    "project.accepted": ["项目改动已接纳", "Project changes accepted"],
    "conversation.shared": ["收到会话分享", "Conversation shared with you"],
  }[row.kind];
  if (event) return event[zh ? 0 : 1] + (row.value ? " · " + row.value : "");
  if (row.kind === "status") return (zh ? "成员状态已变更为 " : "Membership status changed to ") +
    (row.value === "suspended" ? t.memberSuspended : t.memberActive);
  if (row.kind === "role") return (zh ? "身份已变更为 " : "Role changed to ") + roleName(row.value ?? "",t);
  if (row.kind === "department") return (zh ? "部门已变更为 " : "Department changed to ") + (row.value ?? t.unassigned);
  return zh ? "你已被移出此组织" : "Your access to this organization was removed";
}

export function MemberNoticeHistory({ controller, state, t, language }: {
  controller: EnterpriseController;
  state: Pick<EnterpriseState, "memberNotices" | "memberNoticeError">;
  t: EnterpriseLabels;
  language: string;
}) {
  const [open, setOpen] = useState(false);
  const count = state.memberNotices?.unreadCount ?? state.memberNotices?.items.filter(row => row.readAt === null).length ?? 0;
  const label = count ? format(t.memberNoticesUnread, { count }) : t.memberNotices;
  return <>
    <Tooltip side="bottom" label={label}>
      <Button variant="outline" className={css.memberNoticeButton} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        icon={<BellGlyph size={18} />} onClick={() => { setOpen(true); void controller.loadNotices(); }}>
        {count > 0 && <span aria-hidden="true" className={css.memberNoticeBadge}>{count > 99 ? "99+" : count}</span>}
      </Button>
    </Tooltip>
    {open && <Modal open title={t.memberNotices} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => setOpen(false)}>
      <MemberNoticeList controller={controller} state={state} count={count} t={t} language={language} close={() => setOpen(false)}/>
    </Modal>}
  </>;
}

function MemberNoticeList({ controller, state, count, t, language, close }: {
  controller: EnterpriseController;
  state: Pick<EnterpriseState, "memberNotices" | "memberNoticeError">;
  count: number;
  t: EnterpriseLabels;
  language: string;
  close(): void;
}) {
  const task = useTask(t);
  const { memberNotices: feed, memberNoticeError: error } = state;
  return <>
    <Notice error={error} t={t} retry={() => void controller.loadNotices()}/>
    <FormError message={task.error}/>
    {!feed ? (!error && <ListSkeleton/>) : <>
      {count > 0 && <div className={css.memberNoticeActions}>
        <Button size="sm" variant="ghost" disabled={task.busy} onClick={() => void task.run(async () => {
          await controller.readNotices(feed.unreadCount === undefined
            ? { ids: feed.items.filter(row => row.readAt === null).map(row => row.id) }
            : { all: true });
        })}>{t.markMemberNoticesRead}</Button>
      </div>}
      {feed.items.length ? feed.items.map(row => {
        const { enterpriseId, tab } = row;
        const canOpen = enterpriseId && tab && controller.getSnapshot().catalog?.enterprises.some(item => item.id === enterpriseId);
        return <Row key={row.id} title={row.name} meta={noticeMessage(row, t, language.startsWith("zh"))}
          aside={<When at={row.createdAt} language={language}/>} actions={canOpen &&
            <Button size="sm" variant="ghost" disabled={task.busy} onClick={() => void task.run(async () => {
              if (row.readAt === null && !await controller.readNotices({ ids: [row.id] })) return;
              controller.openNotice(enterpriseId, tab, row.targetId ?? undefined);
              close();
            })}>{t.open}</Button>}/>;
      }) : <p>{t.noMemberNotices}</p>}
    </>}
  </>;
}

export function OrganizationNotices({ controller, t, language }: {
  controller:EnterpriseController; t:EnterpriseLabels; language:string;
}) {
  const zh = language.startsWith("zh");
  useEffect(() => {
    let active = true, pending = false;
    const shown = new Set<string>();
    const receive = async () => {
      if (!active || pending || document.hidden) return;
      pending = true;
      try {
        const feed = await controller.loadNotices();
        if (!feed || !active || document.hidden || controller.getSnapshot().toast) return;
        const unread = feed.items.filter(notice => notice.readAt === null);
        for (const noticeId of shown) if (!unread.some(row => row.id === noticeId)) shown.delete(noticeId);
        const row = unread.find(notice => !shown.has(notice.id));
        if (!row) return;
        shown.add(row.id);
        controller.notify(row.name + " · " + noticeMessage(row, t, zh));
        if (row.kind === "status" || row.kind === "removed") void controller.load();
      } finally {
        pending = false;
      }
    };
    void receive();
    const timer = window.setInterval(receive, 15_000);
    window.addEventListener("focus", receive);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", receive);
    };
  }, [controller, t, zh]);
  return null;
}
