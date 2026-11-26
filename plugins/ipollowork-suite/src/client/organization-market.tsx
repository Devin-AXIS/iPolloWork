import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {PluginArtworkDefault} from '@deepseek-ai/dsh-client-ui-primitives'
import {FormSelect,TextInput} from '../../../_shared/ui/controls.tsx'
import type {Enterprise,EnterpriseCatalog,OrganizationPublication} from '../shared/enterprise.ts'
import {chinesePluginIntroductions} from '../shared/plugin-introductions.ts'
import type {request} from './api.ts'
import type {Labels} from './locale.ts'
import {installPending,type MarketInstallation} from './market-installation.ts'
import css from './suite.module.css'

/** Read the existing authorized publication list; resolve the exact release again at install time. */
export function OrganizationMarket({call,installation,revision,chinese,t}:{
  call:typeof request|undefined;installation:MarketInstallation;revision:number;chinese:boolean;t:Labels
}) {
  const [organizations,setOrganizations]=useState<Enterprise[]>([])
  const [selected,setSelected]=useState('')
  const [items,setItems]=useState<OrganizationPublication[]>()
  const [organization,setOrganization]=useState<Enterprise>()
  const [query,setQuery]=useState('')
  const [error,setError]=useState('')
  const [installing,setInstalling]=useState<string>()
  const [identity,reset]=useState(0)
  const access=useRef<AbortController|null>(null)
  const {task}=useSyncExternalStore(installation.subscribe,installation.getSnapshot)
  useEffect(()=>{
    const changed=()=>{
      access.current?.abort();setOrganizations([]);setOrganization(undefined);setItems(undefined);setError('');
      setInstalling(undefined);setSelected('');setQuery('');reset(value=>value+1)
    }
    window.addEventListener('ipollo-account-identity-changed',changed)
    return ()=>window.removeEventListener('ipollo-account-identity-changed',changed)
  },[])
  useEffect(()=>{
    if(!call)return
    const controller=new AbortController()
    access.current=controller
    setItems(undefined);setError('');setInstalling(undefined)
    void (async()=>{
      try {
        const catalog=await call<EnterpriseCatalog>('/enterprise',{signal:controller.signal})
        if(controller.signal.aborted)return
        const current=catalog.enterprises.find(item=>item.id===selected)??catalog.enterprises[0]
        setOrganizations(catalog.enterprises);setOrganization(current)
        if(!current){setItems([]);return}
        const result=await call<{items:OrganizationPublication[]}>('/enterprise/organizations/'+encodeURIComponent(current.id)+'/publications/plugin',{signal:controller.signal})
        if(!controller.signal.aborted)setItems(result.items.filter(item=>item.publishedVersion!==null))
      }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'IPW_ACCOUNT_UNAVAILABLE')}
    })()
    return ()=>controller.abort()
  },[call,selected,revision,identity])
  async function install(item:OrganizationPublication) {
    const signal=access.current?.signal
    if(!call||!signal||signal.aborted||!organization||!item.publishedVersion||installing)return
    setInstalling(item.id);setError('')
    try {
      const result=await call<{spec:string}>('/enterprise/organizations/'+encodeURIComponent(organization.id)+'/publications/plugin/'+encodeURIComponent(item.id)+'/versions/'+encodeURIComponent(item.publishedVersion),{signal})
      signal.throwIfAborted()
      await installation.startManual(result.spec,'',item.title)
    }catch(error){if(!signal.aborted)setError(error instanceof Error?error.message:'IPW_ACCOUNT_UNAVAILABLE')}
    finally{if(!signal.aborted)setInstalling(undefined)}
  }
  if(!call)return <p className={css.empty}>{t.enterpriseUnavailable}</p>
  const signedOut=error==='IPW_SIGN_IN_REQUIRED'
  const description=(item:OrganizationPublication)=>(chinese && item.packageName && !/\p{Script=Han}/u.test(item.description)
    ? chinesePluginIntroductions.get(item.packageName) : undefined) ?? item.description
  const filtered=items?.filter(item=>`${item.title} ${item.packageName??''} ${description(item)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const pending=Boolean(task&&(installPending(task.phase)||task.phase==='unconfirmed'))
  return <div aria-busy={!items&&!error}>
    {organizations.length>0&&<div className={css.toolbar}>
      <FormSelect aria-label={t.enterprise} value={organization?.id??''} onChange={event=>setSelected(event.target.value)}>
        {organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </FormSelect>
      <TextInput type="search" className={css.search!} value={query} aria-label={t.search} placeholder={t.search} onChange={event=>setQuery(event.target.value)}/>
    </div>}
    {error&&<p className={css.error} role="alert">{signedOut?t.enterpriseSignIn:`${t.error} (${error})`}
      {!signedOut&&<> <button className={css.back} onClick={()=>reset(value=>value+1)}>{t.retry}</button></>}
    </p>}
    {!items&&!error&&<p className={css.empty} role="status">{t.loading}</p>}
    {items&&<div className={css.pluginList}>
      {filtered?.map(item=><article className={css.card} key={item.id}>
        <div className={css.cardBody}>
          <span className={css.icon}><PluginArtworkDefault size={36}/></span>
          <div className={css.cardCopy}>
            <div className={css.titleRow}><h2>{item.title}</h2><span className={css.version}>{item.publishedVersion}</span></div>
            <p className={css.cardDescription}>{description(item)}</p>
            <div className={css.cardMeta}><span>{organization?.name}</span><span aria-hidden="true">·</span><span>{item.packageName}</span></div>
          </div>
        </div>
        <button type="button" className={css.primary} disabled={Boolean(installing)||pending||!item.packageName} onClick={()=>void install(item)}>{installing===item.id?t.installInspecting:t.install}</button>
      </article>)}
      {!filtered?.length&&<p className={css.empty}>{organizations.length===0?t.enterpriseNoMembership:query.trim()?t.empty:t.enterpriseEmpty}</p>}
    </div>}
  </div>
}
