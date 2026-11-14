import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import { EnterpriseService } from '../src/host/enterprise.ts'

test('enterprise bridge uses native ids keep historical previews local and refuse legacy sharing', async () => {
  const calls: { path: string; body: unknown }[] = []
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type':'application/json' } })
  const account = new AccountService({
    readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: 'https://account.test', token: 'test-token' } }),
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  },resolveConfig({accountOrigin:'https://account.test'}),new AbortController().signal,async (input,init)=>{
    const path=new URL(String(input)).pathname
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-token')
    calls.push({path,body:init?.body?JSON.parse(String(init.body)):undefined})
    if(path.endsWith('get-session')) return json({user:{id:'me',name:'Me',email:'me@test.example'}})
    if(path.endsWith('me/summary')) return json({points:{balance:0}})
    if(path.endsWith('enterprises')) return json({items:[{id:'enterprise',name:'Team',role:'owner',member_count:2}]})
    if(path.endsWith('/collaboration/projects')) return json({items:[]})
    if(path.endsWith('/work')) return json({items:[]})
    if(path.endsWith('projects')) return json({items:[{id:'project',title:'Local project',owner_id:'me',native_id:'native-project',enterprise_id:'enterprise'}]})
    if(path.endsWith('shares')&&!init?.body) return json({items:[]})
    return json({id:'share',url:'https://account.test/share/share'})
  })
  const events = [
    {type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'Request'}]}},
    {type:'user/message',data:{source:{kind:'runtime-context'},content:[{type:'text',text:'private internal prompt'}]}},
    {type:'user/message',data:{source:{kind:'skill-catalog'},content:[{type:'text',text:'private skill catalog'}]}},
    {type:'tool/call',data:{arguments:'private tool content'}},
    {type:'assistant/message',data:{message:{source:{kind:'model'},content:[{type:'reasoning',text:'private reasoning'},{type:'text',text:'Answer'}]}}},
  ]
  let reads=0
  class NativeProject {
    get id() { return 'native-project' }
    get title() { return 'Local project' }
    get path() { return '/private/local/path' }
    get sessionIds() { return ['session'] }
  }
  const bridge=new EnterpriseService(account,{
    workspaceRegistry:{list:()=>[new NativeProject()]},
    sessionQuery:{readSurface:async()=>{reads++;return{events}}},
  },'https://account.test')
  const catalog=await bridge.catalog()
  assert.equal(catalog.projects[0]?.enterpriseName,'Team')
  assert.equal(catalog.projects[0]?.title,'Local project')
  const beforePreview=calls.length
  const preview=await bridge.preview('session')
  const previewPaths=calls.slice(beforePreview).map(c=>c.path)
  assert(previewPaths.includes('/api/v1/projects'))
  for(const unrelated of ['/api/v1/shares','/api/v1/work','/api/v1/collaboration/projects']) assert(!previewPaths.includes(unrelated),unrelated)
  assert.equal(preview.project.enterpriseId,'enterprise')
  assert.deepEqual(preview.transcript,[{role:'user',content:'Request'},{role:'assistant',content:'Answer'}])
  await assert.rejects(bridge.request('POST','/shares',{sessionId:'session',title:'Shared',visibility:'enterprise',recipients:[],revision:preview.revision}),{code:'NATIVE_SHARING_REQUIRED'})
  const previousReads=reads
  await assert.rejects(bridge.preview('unrelated-session'),{code:'IPW_PROJECT_NOT_FOUND'})
  assert.equal(reads,previousReads)
  await assert.rejects(bridge.request('POST','/join',{invitation:'https://foreign.test/invite/'+'x'.repeat(43)}),{code:'IPW_INVALID_INVITATION'})
})
