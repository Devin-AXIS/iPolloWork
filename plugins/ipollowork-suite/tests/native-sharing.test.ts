import test from 'node:test'
import assert from 'node:assert/strict'
import {createNativeShare,sharingStatus,authorizeNativeShare,type NativeSharing} from '../src/host/native-sharing.ts'
import type {AccountService} from '../src/host/account.ts'
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
