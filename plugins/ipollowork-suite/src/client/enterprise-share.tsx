/** Publish through DSH Liveshare; project content is never copied into the account service. */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseCatalog } from '../shared/enterprise.ts'
import type { EnterpriseController } from './enterprise-controller.ts'
import type { EnterpriseLabels } from './enterprise-locale.ts'
import { projectCopy } from './project-copy.ts'
import { CopyLink, Field, FormError, ListSkeleton, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import css from './suite.module.css'
interface ShareProps {sessionId:string;title:string;t:EnterpriseLabels;call:Call;controller:EnterpriseController;catalog:EnterpriseCatalog;viewShare(id:string):void;language?:string}
export function ShareDialog({sessionId,title:initial,t,call,controller,catalog,language='en'}:ShareProps){
  const c=projectCopy(language),task=useTask(t)
  const status=useRecord<{ready:boolean;reason:string|null}>('/native-sharing',call,0)
  const [title,setTitle]=useState(initial),[role,setRole]=useState<'view'|'participate'>('view'),[link,setLink]=useState('')
  const [projectId,setProjectId]=useState(catalog.projects.find(project=>project.sessionIds.includes(sessionId))?.cloudId??'')
  return <Modal open title={c.nativeShare} closeLabel={c.close} className={css.enterpriseModal!} onClose={()=>{if(!task.busy)controller.open(null)}}>
    <div className={css.enterpriseForm}>
      <p className={css.muted}>{c.nativeHint}</p>
      {link?<CopyLink url={link} t={t}/>:!status.data?<><ListSkeleton rows={2}/><FormError message={status.error}/></>:!status.data.ready?<p role="status">{status.data.reason==='NATIVE_SHARING_DISABLED'?c.nativeMissing:c.nativeLogin}</p>:<>
        <Field label={c.title}><input maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} disabled={task.busy}/></Field>
        <Field label={t.teamProjects}><select value={projectId} onChange={e=>setProjectId(e.target.value)} disabled={task.busy}><option value="">{c.selectProject}</option>{catalog.sharedProjects.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}</select></Field>
        <Field label={t.permission}><select value={role} onChange={e=>setRole(e.target.value as 'view'|'participate')} disabled={task.busy}><option value="view">{c.view}</option><option value="participate">{c.participate}</option></select></Field>
        <FormError message={task.error}/><Button variant="primary" disabled={task.busy||!title.trim()||!projectId} onClick={()=>void task.run(async()=>{
          await call('/native-sharing/configure',{})
          const native=async<T,>(path:string,input:unknown):Promise<T>=>{const response=await fetch('/api/liveshare.'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw new Error(c.nativeLogin);return value as T}
          const started=await native<{state:string;authorizeUrl:string}>('ownerLoginStart',{})
          try {
            const {code}=await call<{code:string}>('/native-sharing/authorize',{authorizeUrl:started.authorizeUrl})
            await native('ownerLoginRedeem',{state:started.state,code})
          } catch(error) { await native('ownerLoginCancel',{state:started.state});throw error }
          const result=await call<{link:string}>('/native-sharing',{sessionId,title,role,projectId});setLink(result.link)
        })}>{c.nativeShare}</Button>
      </>}
    </div>
  </Modal>
}
