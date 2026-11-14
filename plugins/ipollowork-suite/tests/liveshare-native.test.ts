/** Opt-in test for a disposable native DSH home and the seeded local account service. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const launch=process.env.IPOLLO_QA_URL
const relay=process.env.IPOLLO_RELAY_ORIGIN
const password=process.env.IPOLLO_RELAY_TEST_PASSWORD
interface Account {token:string;user:{id:string}}
interface Share {shareId:string;link:string}
interface Envelope {result:{ok:boolean;value?:{accepted?:boolean;sessionId?:string};error?:{code:string}}}
test('native relay carries continuation, forks and streams and revokes project access', {skip:!launch||!relay||!password,timeout:60000},async()=>{
 const origin=new URL(launch!).origin
 const boot=await fetch(launch!,{redirect:'manual'})
 const cookie=boot.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
 assert(cookie)
 const native=async<T,>(path:string,input?:unknown,method='POST'):Promise<T>=>{
  const response=await fetch(origin+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})})
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result as T
 }
 const account=async(email:string):Promise<Account>=>{
  const response=await fetch(relay+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json','x-ipollo-peer-ip':email.startsWith('qa-owner')?'198.51.100.1':'198.51.100.2'},body:JSON.stringify({email,password})})
  assert.equal(response.status,200);return await response.json() as Account
 }
 const owner=await account('qa-owner@example.test'),member=await account('qa-member@example.test')
 const business=async<T,>(path:string,body?:unknown,method?:string):Promise<T>=>{
  const response=await fetch(relay+'/api/v1/'+path,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const result=await response.json();assert(response.ok,JSON.stringify(result));return result as T
 }
 const teams=await business<{items:{id:string}[]}>('enterprises')
 const enterpriseId=teams.items[0]!.id
 const current=await native<{status:string;user?:{email:string}}>('/ipollowork-suite/account',undefined,'GET')
 if(current.user?.email!=='qa-owner@example.test')await native('/ipollowork-suite/account/sign-in',{email:'qa-owner@example.test',password})
 const workspace=await native<{id:string}>('/ipollo-fixture/project',{path:await mkdtemp(join(tmpdir(),'ipw-native-relay-')),title:'Native relay test'})
 const project=await business<{id:string}>('projects',{title:'Native relay test',nativeId:workspace.id,enterpriseId})
 await business('projects/'+project.id+'/access',{mode:'selected',grants:[{kind:'member',subjectId:member.user.id,role:'participate'}]},'PUT')
 await native('/ipollowork-suite/enterprise/projects/'+project.id+'/link',{workspaceId:workspace.id})
 await native('/ipollowork-suite/enterprise/native-sharing/configure',{})
 const started=await native<{state:string;authorizeUrl:string}>('/api/liveshare.ownerLoginStart',{})
 const code=await native<{code:string}>('/ipollowork-suite/enterprise/native-sharing/authorize',{authorizeUrl:started.authorizeUrl})
 await native('/api/liveshare.ownerLoginRedeem',{state:started.state,code:code.code})
 const session=await native<{sessionId:string}>('/ipollo-fixture/run',{projectId:workspace.id,agentPreset:'standard',prompt:'Native relay baseline'})
 const shares:Share[]=[]
 try {
  for(const role of ['view','participate'])shares.push(await native('/ipollowork-suite/enterprise/native-sharing',{projectId:project.id,sessionId:session.sessionId,title:'Native relay test',role}))
  const tickets:string[]=[]
  for(const share of shares){
   const response=await fetch(share.link,{headers:{Authorization:'Bearer '+member.token}})
   const wrapper=await response.text();assert.equal(response.status,200)
   assert(wrapper.includes('sandbox="allow-scripts allow-forms allow-downloads"'))
   const frame=wrapper.match(/src="(\/__liveshare\/assets\/([^/]+)\/)"/)
   assert(frame);tickets.push(frame[2]!)
   const document=await fetch(relay!+frame[1]!);assert.equal(document.status,200)
   assert(document.headers.get('content-security-policy')?.includes('sandbox allow-scripts'))
   assert((await document.text()).includes('installNativeViewerCarrier'))
  }
  const send=async(index:number,body:unknown)=>{
   const response=await fetch(relay+'/__share/rpc?shareId='+shares[index]!.shareId,{method:'POST',headers:{Authorization:'Bearer '+tickets[index],'Content-Type':'application/json'},body:JSON.stringify(body)})
   return {status:response.status,body:await response.json() as Envelope}
  }
  const rpc=(index:number,method:string,request:unknown)=>send(index,{op:'call',path:'/api/'+method,body:{type:'client-request',rpcId:randomUUID(),method,payload:{args:{request}}}})
  const prompt={sessionId:session.sessionId,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'COLLEAGUE_NATIVE_RELAY_TEST'}]}
  const denied=await rpc(0,'session/prompt',prompt);assert.equal(denied.status,403)
  assert.equal((await rpc(0,'session/fork',{sessionId:session.sessionId,operationId:randomUUID()})).status,403)
  const accepted=await rpc(1,'session/prompt',prompt);assert.equal(accepted.body.result.value?.accepted,true)
  const fork=await rpc(1,'session/fork',{sessionId:session.sessionId,operationId:randomUUID()});assert(fork.body.result.value?.sessionId)
  const stream=await send(1,{op:'stream-open',id:770001,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId:session.sessionId}}}}});assert.equal(stream.status,200)
  assert.equal((await send(1,{op:'stream-next',id:770001})).status,200)
  assert.equal((await send(1,{op:'stream-cancel',id:770001})).status,200)
  const page=await rpc(1,'session/page',{address:{kind:'session',sessionId:session.sessionId}});assert(page.body.result.ok);assert(JSON.stringify(page).includes('COLLEAGUE_NATIVE_RELAY_TEST'))
  await business('projects/'+project.id+'/access',{mode:'selected',grants:[]},'PUT')
  assert.equal((await rpc(1,'session/prompt',{...prompt,requestId:randomUUID()})).status,403)
 } finally {
  // Explicitly opt-in disposable fixture; stop both native shares without touching working profiles.
  for(const share of shares)await native('/ipollowork-suite/enterprise/native-sharing/'+share.shareId,undefined,'DELETE')
 }
})
