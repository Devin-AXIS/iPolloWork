/** Delegate session sharing to the mounted DSH service; no transcript copies or relay implementation. */
import { z } from 'zod'
import { SuiteError } from './errors.ts'
import type { AccountService } from './account.ts'
export interface NativeSharing {
  identity(request: Record<string,never>):Promise<{state:string;relay:string;subjectId?:string}>
  setRelay(request:{relayUrl:string}):Promise<unknown>
  list():Promise<{shares:readonly {shareId:string;sessionTitle:string;link:string;online:boolean}[]}>
  create(request:{sessionId:string;sessionTitle:string;sessionMode:'view'|'write';allowsFork:boolean;accessMode:'selected';allowedSubjectIds:string[]}):Promise<{link:string;shareId:string}>
  stop(request:{shareId:string}):Promise<unknown>
}
export async function sharingStatus(service:NativeSharing|undefined,account:Pick<AccountService,'request'>) {
  if(!service)return{ready:false,reason:'NATIVE_SHARING_DISABLED',shares:[]}
  return{ready:true,reason:null,...await account.request('/api/v1/liveshare/shares') as {shares:unknown[]}}
}
export async function createNativeShare(service:NativeSharing|undefined,input:unknown,account:Pick<AccountService,'request'|'state'>){
  const request=z.object({projectId:z.string().min(1).max(200),sessionId:z.string().min(1).max(200),title:z.string().trim().min(1).max(120),role:z.enum(['view','participate'])}).parse(input)
  if(!service)throw new SuiteError('NATIVE_SHARING_DISABLED',409)
  const identity=await service.identity({})
  const owner=await account.state()
  if(owner.status!=='signed-in'||identity.state!=='verified'||identity.relay!==owner.origin||identity.subjectId!==owner.user.id)throw new SuiteError('NATIVE_SHARING_LOGIN_REQUIRED',409)
  const intent=z.object({intent:z.string()}).parse(await account.request('/api/v1/liveshare/intents',request))
  const created=await service.create({sessionId:request.sessionId,sessionTitle:request.title,sessionMode:request.role==='view'?'view':'write',allowsFork:request.role==='participate',accessMode:'selected',allowedSubjectIds:[intent.intent]})
  return {...created,link:owner.origin+'/s/'+encodeURIComponent(created.shareId)}
}

/** Redeem only the native host's PKCE challenge against the currently connected account. */
export async function authorizeNativeShare(account:Pick<AccountService,'state'|'request'>,input:unknown){
  const {authorizeUrl}=z.object({authorizeUrl:z.url()}).parse(input)
  const owner=await account.state(),url=new URL(authorizeUrl)
  if(owner.status!=='signed-in'||url.origin!==owner.origin||url.pathname!=='/__liveshare/owner-authorize')throw new SuiteError('IPW_INVALID_INPUT',400)
  return account.request('/api/v1/liveshare/authorize',{challenge:url.searchParams.get('code_challenge'),instanceKey:url.searchParams.get('instance')})
}

/** Stop an owned native share without leaving the relay link active. */
export async function stopNativeShare(service:NativeSharing|undefined,account:Pick<AccountService,'state'>,shareId:string){
  if(!service)throw new SuiteError('NATIVE_SHARING_DISABLED',409)
  const identity=await service.identity({}),owner=await account.state()
  if(owner.status!=='signed-in'||identity.relay!==owner.origin||identity.subjectId!==owner.user.id)throw new SuiteError('NATIVE_SHARING_LOGIN_REQUIRED',409)
  return service.stop({shareId:z.string().regex(/^[\w-]{1,200}$/).parse(shareId)})
}
