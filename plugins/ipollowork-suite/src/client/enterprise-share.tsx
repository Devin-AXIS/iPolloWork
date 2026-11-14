/** Recipient selection inside the native DSH share dialog. */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { EnterpriseDetail } from '../shared/enterprise.ts'
import type { Props } from './enterprise.tsx'
import { shareAudienceCopy } from './share-audience-copy.ts'
import css from './suite.module.css'

type NativeRequest = { sessionId:string;sessionTitle?:string;sessionMode?:'view'|'write';allowsFork?:boolean;ttlMinutes?:number;accessMode?:'open'|'selected';allowedSubjectIds?:readonly string[] }
type Selection = { blockedReason?:string;failureMessage:string;prepare(request:NativeRequest):Promise<NativeRequest> }
type AudienceProps = Pick<Props,'useEnterpriseState'|'useLocale'|'controller'|'openAccountSettings'> & {
  shareSessionId:string;disabled:boolean;onChange(value:Selection|undefined):void;
}
export function ShareAudience({shareSessionId,disabled,onChange,useEnterpriseState,useLocale,controller,openAccountSettings}:AudienceProps){
  const state=useEnterpriseState(value=>value),t=shareAudienceCopy(useLocale(value=>value))
  const [kind,setKind]=useState<'link'|'team'|'departments'|'members'>('link')
  const [team,setTeam]=useState(''),[picked,setPicked]=useState<string[]>([])
  const [record,setRecord]=useState<{id:string;detail?:EnterpriseDetail;error?:boolean}|null>(null),[revision,setRevision]=useState(0)
  const teamId=state.catalog?.enterprises.some(item=>item.id===team)?team:state.catalog?.enterprises[0]?.id||''
  useLayoutEffect(()=>setPicked([]),[teamId])
  useEffect(()=>{
    if(!state.signedIn||!teamId||kind==='link'||kind==='team')return
    let active=true
    setRecord({id:teamId})
    void controller.call<EnterpriseDetail>('/organizations/'+teamId).then(detail=>{if(active)setRecord({id:teamId,detail})},()=>{if(active)setRecord({id:teamId,error:true})})
    return()=>{active=false}
  },[controller,state.signedIn,teamId,kind,revision])
  const detail=record?.id===teamId?record.detail:undefined
  const needsPeople=kind==='members'||kind==='departments'
  const blockedReason=kind==='link'?undefined:!state.signedIn?t.signIn:!teamId?t.chooseTeam:needsPeople&&!detail?t.loading:needsPeople&&!picked.length?t.chooseRecipients:undefined
  const projectId=state.catalog?.projects.find(project=>project.sessionIds.includes(shareSessionId))?.cloudId??undefined
  const selection=useMemo<Selection>(()=>({...blockedReason?{blockedReason}:{},failureMessage:t.failed,prepare:request=>controller.call<NativeRequest>('/native-sharing/prepare',{
    request,projectId,audience:kind==='link'?{kind}:kind==='team'?{kind,enterpriseId:teamId}:kind==='departments'?{kind,enterpriseId:teamId,departmentIds:picked}:{kind,enterpriseId:teamId,userIds:picked},
  })}),[blockedReason,t,controller,projectId,kind,teamId,picked])
  useLayoutEffect(()=>{onChange(selection);return()=>onChange(undefined)},[onChange,selection])
  const choose=(value:string)=>setPicked(current=>current.includes(value)?current.filter(id=>id!==value):[...current,value])
  const rows=kind==='departments'?detail?.departments.map(row=>({id:row.id,label:row.name})):detail?.members.map(row=>({id:row.userId,label:row.name||row.email}))
  return <div className={css.shareAudience}>
    <label>{t.title}<select value={kind} disabled={disabled} onChange={event=>{setKind(event.target.value as typeof kind);setPicked([])}}>
      <option value="link">{t.link}</option><option value="team">{t.team}</option><option value="departments">{t.departments}</option><option value="members">{t.members}</option>
    </select></label>
    {kind==='link'?<p>{t.linkHint}</p>:!state.signedIn?<button type="button" onClick={openAccountSettings}>{t.signIn}</button>:<>
      <label>{t.team}<select value={teamId} disabled={disabled} onChange={event=>{setTeam(event.target.value);setPicked([])}}>
        <option value="">{t.chooseTeam}</option>{state.catalog?.enterprises.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {needsPeople&&teamId&&(record?.error?<button type="button" onClick={()=>setRevision(value=>value+1)}>{t.retry}</button>:!detail?<p role="status">{t.loading}</p>:<div className={css.shareRecipients}>
        {rows?.length?rows.map(row=><label key={row.id}><input type="checkbox" checked={picked.includes(row.id)} disabled={disabled} onChange={()=>choose(row.id)}/><span>{row.label}</span></label>):<p>{t.empty}</p>}
      </div>)}
      <p>{t.teamHint}</p>
    </>}
  </div>
}
