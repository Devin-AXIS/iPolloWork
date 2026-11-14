/** Project files, accepted memory and contributions, with explicit view/participate/maintain access. */
import { useState } from 'react'
import { Button, IconChevronLeftOutlineRegular, Modal, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseCatalog, EnterpriseDetail, ProjectSpace, ProjectGrant, ProjectRole, ProjectChange } from '../shared/enterprise.ts'
import type { EnterpriseController } from './enterprise-controller.ts'
import type { EnterpriseLabels } from './enterprise-locale.ts'
import { EmptyState, Field, FormError, ListSkeleton, Markdown, Notice, Row, Section, When, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import { projectCopy } from './project-copy.ts'
import css from './suite.module.css'

export interface CollaborationActions { openProject(workspaceId:string):void }
export interface ViewProps {t:EnterpriseLabels;language:string;call:Call;controller:EnterpriseController;catalog:EnterpriseCatalog;revision:number;actions:CollaborationActions}

export function ActivityTab({enterpriseId,view}:{enterpriseId:string|null;view:ViewProps}) {
  const {t,call,language}=view,c=projectCopy(language),task=useTask(t)
  const data=useRecord<{ready:boolean;reason:string|null;shares:{shareId:string;sessionTitle:string;link:string;online:boolean;ownerId:string;projectId:string|null;enterpriseId?:string|null}[]}>('/native-sharing',call,view.revision)
  if(!data.data)return data.error?<Notice error={data.error} t={t} retry={data.reload}/>:<ListSkeleton/>
  const shares=data.data.shares.filter(share=>share.enterpriseId===enterpriseId||(share.enterpriseId===undefined&&view.catalog.sharedProjects.some(project=>project.id===share.projectId&&project.enterpriseId===enterpriseId)))
  return <Section title={c.nativeReady}>
    <p className={css.muted}>{c.nativeHint}</p>
    {!data.data.ready?<p className={css.quietLine}>{data.data.reason==='NATIVE_SHARING_DISABLED'?c.nativeMissing:c.nativeLogin}</p>:
      shares.length?<div className={css.enterpriseList}>{shares.map(s=><Row key={s.shareId} title={s.sessionTitle} meta={s.online?'':c.nativeOffline} onOpen={()=>window.open(s.link,'_blank','noopener,noreferrer')} actions={s.ownerId===view.catalog.userId?<Button variant="ghost" size="sm" disabled={task.busy} onClick={()=>void task.run(async()=>{await call('/native-sharing/'+s.shareId,undefined,'DELETE');data.reload()})}>{c.stopShare}</Button>:undefined}/>)}</div>:<p className={css.quietLine}>{c.nativeEmpty}</p>}
    <FormError message={task.error}/>
  </Section>
}
export function ProjectsTab({enterpriseId,view}:{enterpriseId:string;view:ViewProps}){
  const {catalog,controller,t,call,actions}=view,task=useTask(t)
  const projects=catalog.sharedProjects.filter(p=>p.enterpriseId===enterpriseId)
  const personal=catalog.projects.filter(p=>p.enterpriseId===null)
  return <div className={css.enterpriseStack}>
    <Section title={t.teamProjects} actions={<Button variant="primary" onClick={()=>controller.open({kind:'createProject'})}>{t.createProject}</Button>}>
      {projects.length?<div className={css.enterpriseList}>{projects.map(p=><Row key={p.id} title={p.title} onOpen={()=>controller.push({kind:'project',id:p.id})}
        actions={catalog.projects.find(local=>local.cloudId===p.id)?<Button variant="ghost" size="sm" onClick={()=>actions.openProject(catalog.projects.find(local=>local.cloudId===p.id)!.id)}>{t.open}</Button>:undefined}/>)}</div>:<EmptyState title={t.noTeamProjects} hint={t.projectHint}/>}
    </Section>
    {!!personal.length&&<details><summary className={css.muted}>{t.unassignedProjects}</summary><div className={css.enterpriseList}>{personal.map(p=><Row key={p.id} title={p.title} meta={p.path} actions={<Button size="sm" variant="ghost" disabled={task.busy} onClick={()=>void task.run(async()=>{await call('/assign',{projectId:p.id,enterpriseId});await controller.load()})}>{t.assignHere}</Button>}/>)}</div></details>}
    <FormError message={task.error}/>
  </div>
}
function Header({title,view}:{title:string;view:ViewProps}){return <header className={css.viewHeader}><Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={14}/>} onClick={view.controller.back}>{view.t.back}</Button><h1>{title}</h1></header>}

export function ProjectView({id,view}:{id:string;view:ViewProps}){
  const {call,t,controller,catalog,language}=view,c=projectCopy(language),task=useTask(t)
  const record=useRecord<ProjectSpace>('/projects/'+id+'/space',call,view.revision)
  const [tab,setTab]=useState<'files'|'memory'|'changes'>('files'),[dialog,setDialog]=useState<'submit'|'access'|null>(null)
  const [review,setReview]=useState<ProjectChange|null>(null),[draft,setDraft]=useState(''),[base,setBase]=useState(0),[workspace,setWorkspace]=useState('')
  if(!record.data)return <><Header title={catalog.sharedProjects.find(p=>p.id===id)?.title??t.projectsTab} view={view}/>{record.error?<Notice error={record.error} t={t} retry={record.reload}/>:<ListSkeleton/>}</>
  const space=record.data,maintain=space.project.role==='maintain',participate=space.project.role!=='view'
  const refresh=async()=>{record.reload();await controller.load()}
  const accept=async(change:ProjectChange)=>{
    await call('/projects/'+id+'/changes/'+change.id+'/accept',{expectedVersion:change.kind==='memory'?base:space.fileVersion,...(change.kind==='memory'?{text:draft}:{})})
    setReview(null);await refresh()
  }
  const tabs=[{value:'files' as const,label:c.files,id:'project-files',panelId:'project-panel-files'},{value:'memory' as const,label:c.memory,id:'project-memory',panelId:'project-panel-memory'},{value:'changes' as const,label:c.changes+' · '+space.changes.filter(x=>x.status==='pending').length,id:'project-changes',panelId:'project-panel-changes'}] as const
  const selected=tabs.find(x=>x.value===tab)!
  return <>
    <Header title={space.project.title} view={view}/>
    <div className={css.projectToolbar}><span className={css.muted}>{c[space.project.role]}</span><span className={css.spacer}/>{maintain&&<Button variant="ghost" onClick={()=>setDialog('access')}>{c.people}</Button>}{participate&&<Button variant="primary" onClick={()=>setDialog('submit')}>{c.submit}</Button>}</div>
    <SegmentedTabs label={space.project.title} items={tabs} value={tab} onChange={setTab}/>
    <div role="tabpanel" id={selected.panelId} aria-labelledby={selected.id} className={css.projectContent}>
      {tab==='files'&&(space.files.length?<div className={css.enterpriseList}>{space.files.map(file=><Row key={file.path} title={file.path} actions={<a className={css.projectDownload} href={'/ipollowork-suite/enterprise/download/'+encodeURIComponent(file.resourceId)} target="_blank" rel="noreferrer">{c.download}</a>}/>)}</div>:<EmptyState title={c.filesEmpty}/>)}
      {tab==='memory'&&(space.memory.text?<Markdown text={space.memory.text} t={t}/>:<EmptyState title={c.memoryEmpty}/>)}
      {tab==='changes'&&(space.changes.length?<div className={css.enterpriseList}>{space.changes.map(change=><Row key={change.id} title={change.title} meta={<>{change.author_name} · {c[change.kind]} · <When at={change.created_at} language={language}/></>} aside={<Tag tone={change.status==='accepted'?'success':'outline'}>{c[change.status]}</Tag>} onOpen={()=>void task.run(async()=>{const detail=await call<ProjectChange>('/projects/'+id+'/changes/'+change.id);setReview(detail);setBase(space.memory.version);setDraft(space.memory.text+(detail.kind==='memory'?'\n\n'+JSON.parse(detail.content).text:''))})}/>)}</div>:<EmptyState title={c.changesEmpty}/>)}
    </div>
    <details className={css.projectLocal}><summary>{c.local}</summary><div className={css.enterprisePath}><select aria-label={c.local} value={workspace} onChange={e=>setWorkspace(e.target.value)}><option value="">{t.chooseLocalProject}</option>{catalog.projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select><Button variant="outline" disabled={!workspace||task.busy} onClick={()=>void task.run(async()=>{await call('/projects/'+id+'/link',{workspaceId:workspace});controller.notify(c.linked);view.actions.openProject(workspace)})}>{c.connect}</Button></div><p className={css.muted}>{c.localHint}</p></details>
    <FormError message={task.error}/>
    {dialog==='submit'&&<SubmitDialog space={space} view={view} close={()=>setDialog(null)} done={refresh}/>}
    {dialog==='access'&&maintain&&<AccessDialog space={space} view={view} close={()=>setDialog(null)} done={refresh}/>}
    {review&&<Modal open title={review.title} closeLabel={c.close} className={css.enterpriseModal+' '+css.enterpriseWide} contentClassName={css.enterpriseModalContent!} onClose={()=>{if(!task.busy)setReview(null)}}>
      {review.kind==='memory'?<div className={css.enterpriseForm}><Field label={c.proposal}><Markdown text={(JSON.parse(review.content) as {text:string}).text} t={t}/></Field>{maintain&&review.status==='pending'&&<><p className={css.muted}>{c.memoryHint}</p><Field label={c.next}><textarea className={css.textarea} value={draft} rows={12} maxLength={100000} onChange={e=>setDraft(e.target.value)}/></Field><details><summary>{c.current}</summary><Markdown text={space.memory.text} t={t}/></details><Button variant="ghost" onClick={()=>void task.run(async()=>{const latest=await call<ProjectSpace>('/projects/'+id+'/space');setBase(latest.memory.version);record.reload()})}>{c.useLatest}</Button></>}</div>:
        <div className={css.enterpriseList}>{(JSON.parse(review.content) as {files:{path:string;resourceId:string|null}[]}).files.map(f=><Row key={f.path} title={f.path} meta={f.resourceId?'':c.removed} actions={f.resourceId?<a href={'/ipollowork-suite/enterprise/download/'+encodeURIComponent(f.resourceId)} target="_blank" rel="noreferrer">{c.download}</a>:undefined}/>)}</div>}
      <FormError message={task.error}/>
      {review.status==='pending'&&<div className={css.dialogFooter}>{review.author_id===catalog.userId&&<Button variant="ghost" disabled={task.busy} onClick={()=>void task.run(async()=>{await call('/projects/'+id+'/changes/'+review.id,undefined,'DELETE');setReview(null);await refresh()})}>{c.withdraw}</Button>}<span className={css.spacer}/>{maintain&&<Button variant="primary" disabled={task.busy||review.kind==='memory'&&!draft.trim()} onClick={()=>void task.run(()=>accept(review))}>{c.accept}</Button>}</div>}
    </Modal>}
  </>
}

function SubmitDialog({space,view,close,done}:{space:ProjectSpace;view:ViewProps;close():void;done():Promise<void>}){
  const c=projectCopy(view.language),task=useTask(view.t),[kind,setKind]=useState<'files'|'memory'>('files'),[title,setTitle]=useState(''),[text,setText]=useState(''),[files,setFiles]=useState<File[]>([])
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID())
  const [uploaded,setUploaded]=useState(new Map<File,string>())
  const change=()=>setRequestId(crypto.randomUUID())
  const submit=()=>void task.run(async()=>{
    const selected=[]
    for(const file of files){
      let resourceId=uploaded.get(file)
      if(!resourceId){
        const form=new FormData();form.set('file',file);form.set('metadata',JSON.stringify({title:file.name,kind:'attachment',visibility:'private',enterpriseId:space.project.enterpriseId,mime:file.type||'application/octet-stream'}))
        const response=await fetch('/ipollowork-suite/enterprise/upload',{method:'POST',credentials:'same-origin',body:form})
        const result=await response.json() as {id?:string;error?:string};if(!response.ok||!result.id)throw new Error(result.error??'IPW_FILE_TRANSFER_FAILED')
        resourceId=result.id;uploaded.set(file,resourceId);setUploaded(new Map(uploaded))
      }
      selected.push({path:file.name,resourceId,baseResourceId:space.files.find(f=>f.path===file.name)?.resourceId??null})
    }
    await view.call('/projects/'+space.project.id+'/changes',{requestId,kind,title,baseVersion:kind==='files'?space.fileVersion:space.memory.version,...(kind==='memory'?{text}:{files:selected})})
    view.controller.notify(c.submitted);close();await done()
  })
  return <Modal open title={c.submit} closeLabel={c.close} className={css.enterpriseModal+' '+css.enterpriseWide} contentClassName={css.enterpriseModalContent!} onClose={()=>{if(!task.busy)close()}}>
    <form className={css.enterpriseForm} onSubmit={e=>{e.preventDefault();submit()}}>
      <div className={css.pillRow}><Button variant={kind==='files'?'primary':'outline'} disabled={task.busy} onClick={()=>{setKind('files');change()}}>{c.submitFiles}</Button><Button variant={kind==='memory'?'primary':'outline'} disabled={task.busy} onClick={()=>{setKind('memory');change()}}>{c.submitMemory}</Button></div>
      <Field label={c.title}><input required maxLength={120} value={title} disabled={task.busy} placeholder={c.emptyTitle} onChange={e=>{setTitle(e.target.value);change()}}/></Field>
      {kind==='memory'?<Field label={c.content}><textarea required className={css.textarea} rows={9} maxLength={100000} value={text} disabled={task.busy} onChange={e=>{setText(e.target.value);change()}}/></Field>:<Field label={c.chooseFiles} hint={c.fileHint}><input type="file" multiple required disabled={task.busy} onChange={e=>{setFiles(Array.from(e.target.files??[]));change()}}/></Field>}
      <p className={css.muted}>{c.submitHint}</p><FormError message={task.error}/><div className={css.dialogFooter}><Button variant="outline" disabled={task.busy} onClick={close}>{c.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy||!title.trim()||(kind==='memory'?!text.trim():!files.length)}>{c.submit}</Button></div>
    </form>
  </Modal>
}
function AccessDialog({space,view,close,done}:{space:ProjectSpace;view:ViewProps;close():void;done():Promise<void>}){
  const c=projectCopy(view.language),task=useTask(view.t),[draft,setDraft]=useState<{mode:'enterprise'|'selected';grants:ProjectGrant[]}|null>(null)
  const record=useRecord<{mode:'enterprise'|'selected';grants:ProjectGrant[]}>('/projects/'+space.project.id+'/access',view.call,0)
  const org=useRecord<EnterpriseDetail>('/organizations/'+space.project.enterpriseId,view.call,0)
  const value=draft??record.data
  const select=(kind:'member'|'department',subjectId:string,role:ProjectRole|'none')=>{if(value)setDraft({...value,grants:[...value.grants.filter(g=>g.kind!==kind||g.subjectId!==subjectId),...(role==='none'?[]:[{kind,subjectId,role}])]})}
  const picker=(kind:'member'|'department',subjectId:string)=><select aria-label={c[kind]} disabled={task.busy} value={value?.grants.find(g=>g.kind===kind&&g.subjectId===subjectId)?.role??'none'} onChange={e=>select(kind,subjectId,e.target.value as ProjectRole|'none')}><option value="none">{c.none}</option>{(['view','participate','maintain'] as const).map(role=><option key={role} value={role}>{c[role]}</option>)}</select>
  return <Modal open title={c.people} closeLabel={c.close} className={css.enterpriseModal+' '+css.enterpriseWide} contentClassName={css.enterpriseModalContent!} onClose={()=>{if(!task.busy)close()}}>
    {!value||!org.data?<>{record.error||org.error?<Notice error={record.error||org.error} t={view.t} retry={()=>{record.reload();org.reload()}}/>:<ListSkeleton/>}</>:<div className={css.enterpriseForm}>
      <select aria-label={c.people} value={value.mode} disabled={task.busy} onChange={e=>setDraft({...value,mode:e.target.value as 'enterprise'|'selected'})}><option value="selected">{c.selected}</option><option value="enterprise">{c.everyone}</option></select><p className={css.muted}>{c.accessHint}</p>
      <div className={css.enterpriseList}>{org.data.departments.map(d=><Row key={d.id} title={d.name} meta={c.department} actions={picker('department',d.id)}/>)}{org.data.members.map(m=><Row key={m.userId} title={m.name||m.email} meta={m.email} actions={m.role==='owner'||m.role==='admin'?<Tag tone="outline">{c.maintain}</Tag>:picker('member',m.userId)}/>)}</div>
      <FormError message={task.error}/><div className={css.dialogFooter}><Button variant="outline" disabled={task.busy} onClick={close}>{c.cancel}</Button><Button variant="primary" disabled={task.busy} onClick={()=>void task.run(async()=>{await view.call('/projects/'+space.project.id+'/access',value,'PUT');close();await done()})}>{c.save}</Button></div>
    </div>}
  </Modal>
}
