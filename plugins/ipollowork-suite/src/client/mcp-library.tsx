import { useState, useSyncExternalStore } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { AssetProps } from "./enterprise-assets.tsx";
import { Field, FormError, ListSkeleton, Notice, Row, Section, useRecord, useTask } from "./enterprise-ui.tsx";
import { McpTab } from "./enterprise-mcp.tsx";
import css from "./suite.module.css";

type McpConfig = {
  servers: Record<string, { transport:string; url?:string; enabled?:boolean }>;
};
type Forms = import('./native.ts').ClientContext['configForms'];
export type PublicMcp = {id:string;name:string;description:string;url:string;oauth:boolean};
export const mcpSettings = (forms:Forms) => forms.get<McpConfig>("mcp-manager");
export type McpForm = ReturnType<typeof mcpSettings>;

export function McpLibrary(props: AssetProps & { form:McpForm }) {
  const [preset,setPreset] = useState<PublicMcp>();
  return <>
    <McpTab {...props} preset={preset} clearPreset={() => setPreset(undefined)}/>
    <PersonalMcp {...props}/>
    <PublicMcpCatalog {...props} choose={setPreset}/>
  </>;
}

function PersonalMcp({ form,t,language }:AssetProps & {form:McpForm}) {
  const snapshot=useSyncExternalStore(listener=>form.subscribe(listener),()=>form.getSnapshot());
  const task=useTask(t);
  const zh=language.startsWith("zh");
  const servers=snapshot.value?.servers ?? {};
  const update=async (name:string,value:{transport:"streamable-http";url:string}|null)=>{
    const path=["servers",name];
    const ok=await form.mutate([value ? {op:"set",path,value} : {op:"unset",path}],snapshot.revision);
    if (!ok) throw Error("IPW_SERVICE_UNAVAILABLE");
  };
  return <Section title={zh?"个人 MCP":"Personal MCP"}>
    <FormError message={task.error}/>
    {snapshot.status==="loading" && <ListSkeleton/>}
    {snapshot.status==="unavailable" && <p>{zh?"当前 DSH 配置不支持编辑 MCP。":"MCP settings are unavailable in this DSH profile."}</p>}
    {Object.entries(servers).map(([name,entry]) => <Row key={name} title={name}
      meta={entry.enabled===false?t.modelDisabled:entry.transport} actions={snapshot.writable && <Button size="sm" variant="ghost"
        disabled={task.busy} onClick={()=>void task.run(()=>update(name,null))}>{t.remove}</Button>}/>)}
    {snapshot.writable && <form className={css.enterpriseForm} onSubmit={event=>{
      event.preventDefault();
      const formElement=event.currentTarget, formData=new FormData(formElement);
      const name=String(formData.get("name")??"").trim();
      void task.run(async()=>{
        const url=new URL(String(formData.get("url")??""));
        if (servers[name] || !["http:","https:"].includes(url.protocol) || url.username || url.password)
          throw Error("IPW_INVALID_INPUT");
        await update(name,{transport:"streamable-http",url:url.href});
        formElement.reset();
      });
    }}>
      <Field label={t.name}><input name="name" pattern="[A-Za-z0-9_-]+" maxLength={48} required/></Field>
      <Field label={t.mcpEndpoint}><input name="url" type="url" maxLength={2048} required/></Field>
      <div className={css.enterpriseActions}><Button type="submit" variant="primary" disabled={task.busy}>{zh?"添加 MCP":"Add MCP"}</Button></div>
    </form>}
  </Section>;
}

function PublicMcpCatalog({ call,revision,t,language,detail,choose }:AssetProps & {choose(item:PublicMcp):void}) {
  const state=useRecord<{items:PublicMcp[]}>("/public-mcp",call,revision);
  const zh=language.startsWith("zh");
  if (state.error) return <Notice error={state.error} t={t} retry={state.reload}/>;
  if (!state.data) return <ListSkeleton/>;
  return <Section title={zh?"公开 MCP":"Public MCP"}>
    {state.data.items.map(item=><Row key={item.id} title={item.name} meta={item.description} actions={
      detail.canManage ? <Button variant="outline" size="sm" onClick={()=>choose(item)}>{zh?"添加到组织":"Add to organization"}</Button>
        : <span>{new URL(item.url).hostname}</span>
    }/>)}
  </Section>;
}
