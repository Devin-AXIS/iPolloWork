import test from 'node:test'
import assert from 'node:assert/strict'
import {createNativeShare,prepareNativeShare, nativeShareAudience,sharingStatus,authorizeNativeShare,configureNativeSharing,type NativeSharing} from '../src/host/native-sharing.ts'
import type {AccountService} from '../src/host/account.ts'
test('sharing selects the account server and reuses only a matching verified owner',async()=>{
 const account:Pick<AccountService,'state'>={state:async()=>({status:'signed-in',origin:'https://work.test',user:{id:'owner',email:'owner@example.test',name:'Owner'},points:0,balanceStatus:'available'})}
 let relay='',subjectId='owner',state='unverified'
 const changes:string[]=[]
 const service:NativeSharing={identity:async()=>({state,relay,subjectId}),setRelay:async input=>{relay=input.relayUrl;changes.push(relay)},list:async()=>({shares:[]}),create:async()=>({shareId:'id',link:'https://work.test/s/id'}),stop:async()=>({})}
 assert.deepEqual(await configureNativeSharing(service,account),{ok:true,ready:false})
 state='verified'
 assert.deepEqual(await configureNativeSharing(service,account),{ok:true,ready:true})
 assert(changes.length>0&&changes.every(value=>value==='https://work.test'))
 subjectId='another-owner'
 assert.deepEqual(await configureNativeSharing(service,account),{ok:true,ready:false})
 await assert.rejects(configureNativeSharing(undefined,account),{code:'NATIVE_SHARING_DISABLED'})
 await assert.rejects(configureNativeSharing(service,{state:async()=>({status:'anonymous',origin:'https://work.test'})}),{code:'IPW_SIGN_IN_REQUIRED'})
})
test('native sharing binds authenticated project intent and never uploads transcripts',async()=>{
 const account:Pick<AccountService,'state'|'request'>={state:async()=>({status:'signed-in',origin:'https://native.test',user:{id:'owner',email:'owner@example.test',name:'Owner'},points:0,balanceStatus:'available'}),request:async path=>path.endsWith('/shares')?{shares:[]}:{intent:'ipollo-intent:one'}}
 assert.equal((await sharingStatus(undefined,account)).ready,false)
 const input={projectId:'project',sessionId:'s',title:'Topic',role:'view'}
 await assert.rejects(createNativeShare(undefined,input,account),{code:'NATIVE_SHARING_DISABLED'})
 const calls:unknown[]=[]
 const service:NativeSharing={setRelay:async()=>({}),identity:async()=>({state:'verified',relay:'https://native.test',subjectId:'owner'}),list:async()=>({shares:[]}),stop:async()=>({}),create:async request=>{calls.push(request);return{link:'https://native.test/?shareId=1',shareId:'1'}}}
 assert.equal((await createNativeShare(service,input,account)).link,'https://native.test/s/1')
 await createNativeShare(service,{...input,role:'participate'},account)
 assert.deepEqual(calls,[{sessionId:'s',sessionTitle:'Topic',sessionMode:'view',allowsFork:false,accessMode:'selected',allowedSubjectIds:['ipollo-intent:one']},{sessionId:'s',sessionTitle:'Topic',sessionMode:'write',allowsFork:true,accessMode:'selected',allowedSubjectIds:['ipollo-intent:one']}])
 assert(!JSON.stringify(calls).includes('transcript'))
 service.identity=async()=>({state:'verified',relay:'https://native.test',subjectId:'another-account'})
 await assert.rejects(createNativeShare(service,input,account),{code:'NATIVE_SHARING_LOGIN_REQUIRED'})
 await assert.rejects(authorizeNativeShare(account,{authorizeUrl:'https://attacker.test/__liveshare/owner-authorize'}),{code:'IPW_INVALID_INPUT'})
})

test('native recipient preparation preserves permissions and external public relays',async()=>{
 const calls:unknown[]=[]
 const account:Pick<AccountService,'state'|'request'>={state:async()=>({status:'signed-in',origin:'https://native.test',user:{id:'owner',email:'owner@example.test',name:'Owner'},points:0,balanceStatus:'available'}),request:async(_path,input)=>{calls.push(input);return {intent:'ipollo-intent:recipients'}}}
 const service:NativeSharing={identity:async()=>({state:'verified',relay:'https://native.test',subjectId:'owner'}),setRelay:async()=>({}),list:async()=>({shares:[]}),stop:async()=>({}),create:async()=>({link:'',shareId:''})}
 const request={sessionId:'session',sessionTitle:'Title',sessionMode:'write',allowsFork:false,ttlMinutes:30}
 const result=await prepareNativeShare(service,{request,audience:{kind:'members',enterpriseId:'team',userIds:['member']}},account)
 assert.deepEqual(result,{...request,accessMode:'selected',allowedSubjectIds:['ipollo-intent:recipients']})
 assert.deepEqual(calls,[{projectId:undefined,audience:{kind:'members',enterpriseId:'team',userIds:['member']},sessionId:'session',title:'Title',role:'participate',allowsFork:false}])
 service.identity=async()=>({state:'verified',relay:'https://external.test',subjectId:'owner'})
 assert.deepEqual(await prepareNativeShare(service,{request,audience:{kind:'link'}},account),request)
 await assert.rejects(prepareNativeShare(service,{request,audience:{kind:'team',enterpriseId:'team'}},account),{code:'NATIVE_SHARING_LOGIN_REQUIRED'})
 assert.equal(calls.length,1)
})

test('existing audience reads and updates use the connected owner and keep native permissions separate',async()=>{
 const service:Pick<NativeSharing,'identity'>={identity:async()=>({state:'verified',relay:'http://localhost:4785',subjectId:'owner'})}
 const calls:unknown[]=[]
 const account={state:async()=>({status:'signed-in',origin:'http://localhost:4785',user:{id:'owner'}}),request:async(...args:unknown[])=>{calls.push(args);return{audience:{kind:'team',enterpriseId:'team'}}}} as Pick<AccountService,'state'|'request'>
 assert.deepEqual(await nativeShareAudience(service,account,'share'),{audience:{kind:'team',enterpriseId:'team'}})
 await nativeShareAudience(service,account,'share',{audience:{kind:'team',enterpriseId:'team'}})
 assert.deepEqual(calls,[['/api/v1/liveshare/shares/share/audience',undefined,'GET'],['/api/v1/liveshare/shares/share/audience',{audience:{kind:'team',enterpriseId:'team'}},'PUT']])
 await assert.rejects(nativeShareAudience(service,account,'../bad'))
 const foreign={...service,identity:async()=>({state:'verified',relay:'https://other.test',subjectId:'owner'})}
 assert.deepEqual(await nativeShareAudience(foreign,account,'share'),{audience:null})
 await assert.rejects(nativeShareAudience(foreign,account,'share',{audience:{kind:'link'}}))
})
