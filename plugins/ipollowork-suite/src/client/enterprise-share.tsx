/** Recipient selection inside the native DSH share dialog. */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { EnterpriseDetail } from '../shared/enterprise.ts'
import type { Props } from './enterprise.tsx'
import { shareAudienceCopy } from './share-audience-copy.ts'
import css from './suite.module.css'

type NativeRequest = { sessionId:string;sessionTitle?:string;sessionMode?:'view'|'write';allowsFork?:boolean;ttlMinutes?:number;accessMode?:'open'|'selected';allowedSubjectIds?:readonly string[] }
type Audience = {kind:'link'}|{kind:'team';enterpriseId:string}|{kind:'departments';enterpriseId:string;departmentIds:string[]}|{kind:'members';enterpriseId:string;userIds:string[]}|{kind:'project'}
type Selection = { blockedReason?:string;failureMessage:string;dirty?:boolean;save?:()=>Promise<void>;prepare(request:NativeRequest):Promise<NativeRequest> }
type AudienceProps = Pick<Props,'useEnterpriseState'|'useLocale'|'controller'|'openAccountSettings'> & {
  shareSessionId:string;currentShareId?:string;disabled:boolean;onChange(value:Selection|undefined):void;
}
function audienceKey(value:Audience){return JSON.stringify(value.kind==='departments'?{...value,departmentIds:[...value.departmentIds].sort()}:value)}
export function ShareAudience({shareSessionId,currentShareId,disabled,onChange,useEnterpriseState,useLocale,controller,openAccountSettings}:AudienceProps){
  const state=useEnterpriseState(value=>value),t=shareAudienceCopy(useLocale(value=>value))
  const [kind,setKind]=useState<'link'|'organization'|'legacy'>('link')
  const [scope,setScope]=useState<'all'|'departments'>('all')
  const [organization,setOrganization]=useState('')
  const [picked,setPicked]=useState<{organizationId:string;ids:string[]}>({organizationId:'',ids:[]})
  const [stored,setStored]=useState<{id:string;audience:Audience|null}|null>(null)
  const [loadFailed,setLoadFailed]=useState(false)
  const [record,setRecord]=useState<{id:string;detail?:EnterpriseDetail;error?:boolean}|null>(null),[revision,setRevision]=useState(0)
  const organizations=state.catalog?.enterprises??[]
  const organizationId=organizations.some(item=>item.id===organization)?organization:organization===''&&organizations.length===1?organizations[0]!.id:''
  const departmentIds=picked.organizationId===organizationId?picked.ids:[]
  const needsDepartments=kind==='organization'&&scope==='departments'
  const loading=!!currentShareId&&stored?.id!==currentShareId
  useEffect(()=>{
    if(!currentShareId)return
    let active=true
    setLoadFailed(false)
    void controller.call<{audience:Audience|null}>('/native-sharing/audience/'+currentShareId).then(({audience})=>{
      if(!active)return
      setStored({id:currentShareId,audience})
      if(audience===null)return
      setKind(audience.kind==='link'?'link':audience.kind==='team'||audience.kind==='departments'?'organization':'legacy')
      if(audience.kind==='team'||audience.kind==='departments'){
        setOrganization(audience.enterpriseId);setScope(audience.kind==='team'?'all':'departments')
        setPicked({organizationId:audience.enterpriseId,ids:audience.kind==='departments'?audience.departmentIds:[]})
      }
    },()=>{if(active)setLoadFailed(true)})
    return()=>{active=false}
  },[controller,currentShareId,revision])
  useEffect(()=>{
    if(!state.signedIn||!organizationId||!needsDepartments)return
    let active=true
    setRecord({id:organizationId})
    void controller.call<EnterpriseDetail>('/organizations/'+organizationId).then(detail=>{if(active)setRecord({id:organizationId,detail})},()=>{if(active)setRecord({id:organizationId,error:true})})
    return()=>{active=false}
  },[controller,state.signedIn,organizationId,needsDepartments,revision])
  const currentRecord=record?.id===organizationId?record:undefined
  const detail=currentRecord?.detail
  const blockedReason=loadFailed?t.failed:loading?t.loading:kind==='link'||kind==='legacy'?undefined:!state.signedIn?t.signIn:!organizationId?t.chooseOrganization:needsDepartments&&currentRecord?.error?t.failed:needsDepartments&&!detail?t.loading:needsDepartments&&!departmentIds.length?t.chooseDepartments:undefined
  const projectId=state.catalog?.projects.find(project=>project.sessionIds.includes(shareSessionId))?.cloudId??undefined
  const selection=useMemo<Selection>(()=>{
    const audience:Audience=kind==='link'?{kind:'link'}:kind==='legacy'?{kind:'project'}:scope==='all'?{kind:'team',enterpriseId:organizationId}:{kind:'departments',enterpriseId:organizationId,departmentIds:picked.organizationId===organizationId?picked.ids:[]}
    const dirty=!!currentShareId&&stored?.id===currentShareId&&stored.audience!==null&&kind!=='legacy'&&audienceKey(audience)!==audienceKey(stored.audience)
    return{...blockedReason?{blockedReason}:{},failureMessage:t.failed,dirty,
      save:async()=>{
        if(!currentShareId||blockedReason)return
        const result=await controller.call<{audience:Audience}>('/native-sharing/audience/'+currentShareId,{audience},'PUT')
        setStored({id:currentShareId,audience:result.audience})
      },
      prepare:request=>controller.call<NativeRequest>('/native-sharing/prepare',{request,projectId,audience}),
    }
  },[blockedReason,t,controller,projectId,kind,scope,organizationId,picked,currentShareId,stored])
  const unsupported=!!currentShareId&&stored?.id===currentShareId&&stored.audience===null
  useLayoutEffect(()=>{onChange(unsupported?undefined:selection);return()=>onChange(undefined)},[onChange,selection,unsupported])
  const choose=(value:string)=>setPicked(current=>{
    const ids=current.organizationId===organizationId?current.ids:[]
    return{organizationId,ids:ids.includes(value)?ids.filter(id=>id!==value):[...ids,value]}
  })
  if(unsupported)return null
  const unavailable=disabled||loading
  return <div className={css.shareAudience}>
    <label>{t.title}<select value={kind} disabled={unavailable} onChange={event=>setKind(event.target.value as typeof kind)}>
      <option value="link">{t.link}</option><option value="organization">{t.organization}</option>{kind==='legacy'&&<option value="legacy" disabled>{t.currentAccess}</option>}
    </select></label>
    {loadFailed?<button type="button" disabled={disabled} onClick={()=>setRevision(value=>value+1)}>{t.retry}</button>:loading?<p role="status">{t.loading}</p>:null}
    {kind==='organization'&&(!state.signedIn?<button type="button" disabled={unavailable} onClick={openAccountSettings}>{t.signIn}</button>:<>
      <select aria-label={t.chooseOrganization} value={organizationId} disabled={unavailable} onChange={event=>setOrganization(event.target.value)}>
        <option value="">{t.chooseOrganization}</option>{organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {organizationId&&<>
        <select aria-label={t.scope} value={scope} disabled={unavailable} onChange={event=>setScope(event.target.value as typeof scope)}>
          <option value="all">{t.wholeOrganization}</option><option value="departments">{t.departments}</option>
        </select>
        {needsDepartments&&(currentRecord?.error?<button type="button" disabled={unavailable} onClick={()=>setRevision(value=>value+1)}>{t.retry}</button>:!detail?<p role="status">{t.loading}</p>:<div className={css.shareRecipients}>
          {detail.departments.length?detail.departments.map(row=><label key={row.id}><input type="checkbox" checked={departmentIds.includes(row.id)} disabled={unavailable} onChange={()=>choose(row.id)}/><span>{row.name}</span></label>):<p>{t.empty}</p>}
        </div>)}
      </>}
    </>)}
  </div>
}
