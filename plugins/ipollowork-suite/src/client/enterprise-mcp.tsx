import { useState, type FormEvent } from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { EnterpriseMcp } from "../shared/enterprise.ts";
import { AccessDialog, AudiencePill, RowMenu, type AssetProps } from "./enterprise-assets.tsx";
import { format } from "./enterprise-locale.ts";
import { EmptyState, Field, FormError, ListSkeleton, Notice, Section, useRecord, useTask } from "./enterprise-ui.tsx";
import css from "./suite.module.css";

export function McpTab(props: AssetProps) {
  const { enterpriseId, detail, t, call, controller, revision } = props;
  const path = "/organizations/" + enterpriseId + "/mcp";
  const record = useRecord<{ canManage: boolean; items: EnterpriseMcp[] }>(path, call, revision);
  const [editing, setEditing] = useState<EnterpriseMcp>();
  const [access, setAccess] = useState<EnterpriseMcp | null>(null);
  const [authorizing, setAuthorizing] = useState<EnterpriseMcp>();
  const zh = props.language.startsWith("zh");
  if (!record.data) return record.error
    ? <Notice error={record.error} t={t} retry={record.reload} />
    : <ListSkeleton />;
  const { canManage, items } = record.data;
  return <Section title={t.organizationMcp}>
    {!items.length ? <EmptyState title={t.noMcp} hint={t.noMcpHint} /> :
      <div className={css.peopleList}>{items.map(item => <div key={item.id} className={css.person}>
        <span className={css.personText}>
          <strong>{item.title}</strong>
          <small>{[item.description, item.host, item.enabled === false ? t.modelDisabled : ""].filter(Boolean).join(" · ")}</small>
        </span>
        <AudiencePill audience={item.audience} detail={detail} t={t}
          {...(canManage ? { onEdit: () => setAccess(item) } : {})} />
        {item.oauthRequired && item.enabled !== false && <Button variant="outline" size="sm" onClick={()=>setAuthorizing(item)}>
          {item.authorized ? (zh ? "管理授权" : "Manage authorization") : (zh ? "授权连接" : "Authorize connection")}
        </Button>}
        {canManage && <span className={css.personActions}>
          <RowMenu t={t} items={[
            ...(item.endpoint ? [{id:"edit",label:t.edit}] : []),
            ...(!item.reviewed ? [{ id: "delete", label: t.remove, danger: true }] : []),
          ]} onSelect={id => id === "edit" ? setEditing(item) : controller.open({
            kind: "confirm", title: format(t.deleteMcpTitle, { name: item.title }), description: t.deleteMcpBody,
            confirmLabel: t.remove,
            run: async () => {
              await call(path + "/" + item.id, undefined, "DELETE");
              await controller.load();
            },
          })} />
        </span>}
      </div>)}</div>}
    {canManage && editing && <McpDialog {...props} key={editing.id}
      path={path} item={editing} close={() => setEditing(undefined)} />}
    {canManage && access && <AccessDialog {...props} kind="mcp" assetId={access.id} title={access.title}
      audience={access.audience} close={() => setAccess(null)} />}
    {authorizing && <McpAuthorization {...props} path={path + "/" + authorizing.id + "/oauth"}
      item={authorizing} close={()=>setAuthorizing(undefined)} />}
  </Section>;
}

function McpDialog({ path, t, call, controller, close, item, language }: AssetProps & { path: string; item:EnterpriseMcp; close(): void }) {
  const task = useTask(t);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [endpoint, setEndpoint] = useState(item.endpoint ?? "");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [enabled, setEnabled] = useState(item.enabled ?? true);
  const [OAuth, setOAuth] = useState(item.oauthRequired ?? false);
  const [oauth, setOauth] = useState(item.oauth ?? {authorizationUrl:"",tokenUrl:"",clientId:"",scope:""});
  const zh = language.startsWith("zh");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void task.run(async () => {
      await call(path + "/" + item.id, {
        title, description, endpoint: endpoint.trim(), enabled,
        ...(!OAuth && key ? {key} : !OAuth && clearKey ? {key:null} : {}),
        ...(OAuth ? {oauth} : item.oauthRequired ? {oauth:null} : {}),
      }, "PATCH");
      controller.notify(t.saved);
      close();
      await controller.load();
    });
  };
  return <Modal open title={zh ? "编辑 MCP" : "Edit MCP"} description={t.mcpEndpointHint} closeLabel={t.close}
    className={css.enterpriseModal!} onClose={() => { if (!task.busy) close(); }}>
    <form onSubmit={submit} className={css.enterpriseForm}>
      <Field label={t.name}><input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></Field>
      <Field label={t.skillDescription}><input maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></Field>
      <Field label={t.mcpEndpoint} {...(item.reviewed ? {hint:t.mcpReviewRequired} : {})}>
        <input type="url" required readOnly={item.reviewed} maxLength={2048} value={endpoint} onChange={event => setEndpoint(event.target.value)} />
      </Field>
      <label><input type="checkbox" checked={OAuth} onChange={event=>setOAuth(event.target.checked)}/> {zh ? "成员使用 OAuth 授权" : "Require member OAuth"}</label>
      {OAuth ? <>
        <Field label={zh ? "授权地址" : "Authorization URL"}><input type="url" required value={oauth.authorizationUrl}
          onChange={event=>setOauth({...oauth,authorizationUrl:event.target.value})}/></Field>
        <Field label={zh ? "令牌地址" : "Token URL"}><input type="url" required value={oauth.tokenUrl}
          onChange={event=>setOauth({...oauth,tokenUrl:event.target.value})}/></Field>
        <Field label="OAuth Client ID"><input required value={oauth.clientId} maxLength={256}
          onChange={event=>setOauth({...oauth,clientId:event.target.value})}/></Field>
        <Field label="OAuth Scope"><input value={oauth.scope} maxLength={512}
          onChange={event=>setOauth({...oauth,scope:event.target.value})}/></Field>
        <p>{zh ? "在授权服务中登记组织服务地址 + /api/integrations/organization-mcp/callback 作为回调地址。" :
          "Register your organization service address plus /api/integrations/organization-mcp/callback as the callback URL."}</p>
      </> : <Field label={t.mcpKey}><input type="password" autoComplete="new-password" maxLength={8192} value={key}
        onChange={event => setKey(event.target.value)} /></Field>}
      <label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/> {zh ? "启用此 MCP" : "Enable this MCP"}</label>
      {!OAuth && <label><input type="checkbox" checked={clearKey} disabled={!!key} onChange={event=>setClearKey(event.target.checked)}/> {zh ? "清除已保存的密钥" : "Clear saved key"}</label>}
      <FormError message={task.error} />
      <div className={css.dialogFooter}>
        <Button type="button" variant="outline" disabled={task.busy} onClick={close}>{t.cancel}</Button>
        <Button type="submit" variant="primary" disabled={task.busy || !title.trim() || !endpoint.trim()}>{t.save}</Button>
      </div>
    </form>
  </Modal>;
}

function McpAuthorization({ path, item, call, controller, t, language, close }: AssetProps & {
  path:string; item:EnterpriseMcp; close():void;
}) {
  const task=useTask(t);
  const [url,setUrl]=useState("");
  const zh=language.startsWith("zh");
  return <Modal open title={item.title} closeLabel={t.close} className={css.enterpriseModal!} onClose={()=>{if(!task.busy)close();}}>
    <p>{zh ? "使用你在此 MCP 服务的账号授予访问权限。" : "Use your account with this MCP service to grant access."}</p>
    <FormError message={task.error}/>
    <div className={css.enterpriseActions}>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer">{zh ? "打开授权页面" : "Open authorization page"}</a> :
        <Button variant="primary" disabled={task.busy} onClick={()=>void task.run(async()=>{
          const result=await call<{authorizationUrl:string}>(path,{});
          setUrl(result.authorizationUrl);
        })}>{item.authorized ? (zh ? "重新授权" : "Reauthorize") : (zh ? "获取授权链接" : "Get authorization link")}</Button>}
      {url && <Button variant="outline" onClick={()=>void task.run(async()=>{await controller.load();close();})}>{t.refresh}</Button>}
      {item.authorized && <Button variant="ghost" disabled={task.busy} onClick={()=>void task.run(async()=>{
        await call(path,undefined,"DELETE");await controller.load();close();
      })}>{zh ? "断开授权" : "Disconnect"}</Button>}
    </div>
  </Modal>;
}
