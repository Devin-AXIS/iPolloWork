import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {linkProject,mountProjectContext,type MemoryContext} from '../src/host/project-context.ts'
import {AccountService} from '../src/host/account.ts'
import {resolveConfig} from '../src/host/config.ts'

test('each model step refreshes shared memory and revoked access cannot reuse stale context',async()=>{
 const path=await mkdtemp(join(tmpdir(),'ipw-memory-'))
 let text='Confirmed scope',version=1,allowed=true
 const account=new AccountService({readRecord:async()=>({kind:'grant',payload:{version:1,origin:'https://account.test',token:'fixture'}}),modifyRecord:async()=>{},deleteRecord:async()=>{}},resolveConfig({accountOrigin:'https://account.test'}),new AbortController().signal,async()=>new Response(JSON.stringify(allowed?{title:'Team',text,version}:{code:'PROJECT_FORBIDDEN'}),{status:allowed?200:403,headers:{'Content-Type':'application/json'}}))
 let step:Parameters<MemoryContext['on']>[1]|undefined
 let render:((context:{scope?:object})=>string)|undefined
 const ctx:MemoryContext={on:(_event,listener)=>{step=listener},systemPrompt:{getContextOrder:()=>0,context:input=>{render=input.text}}}
 try{
  await linkProject(path,'https://account.test','project')
  assert(!String(await readFile(join(path,'.ipollo/project.json'))).includes('fixture'))
  mountProjectContext(ctx,account,'https://account.test')
  const agent={session:{header:{cwd:path}}},other={session:{header:{cwd:join(path,'unlinked')}}}
  await step!({agent},async()=>{})
  assert.match(render!({scope:agent}),/Confirmed scope/)
  assert.equal(render!({scope:other}),'')
  text='Updated scope';version=2;await step!({agent},async()=>{})
  assert.match(render!({scope:agent}),/version 2/)
  assert(!render!({scope:agent}).includes('Confirmed scope'))
  allowed=false;await assert.rejects(step!({agent},async()=>{}),{code:'PROJECT_FORBIDDEN'})
  assert.equal(render!({scope:agent}),'')
 }finally{await rm(path,{recursive:true,force:true})}
})

test('legacy official project links refresh at the current service, preserve authorization and recover in local mode', async () => {
 const path=await mkdtemp(join(tmpdir(),'ipw-domain-migration-'))
 const urls:string[]=[]
 let allowed=true,step:Parameters<MemoryContext['on']>[1]|undefined
 let render:((context:{scope?:object})=>string)|undefined
 const account=new AccountService({readRecord:async()=>({kind:'grant',payload:{version:1,origin:'https://cloud.ipollo.net',token:'fixture'}}),modifyRecord:async()=>{},deleteRecord:async()=>{}},resolveConfig({accountOrigin:'https://cloud.ipollo.net'}),new AbortController().signal,async url=>{
  urls.push(String(url))
  return Response.json(allowed?{title:'Team',text:'Authorized memory',version:1}:{code:'PROJECT_FORBIDDEN'},{status:allowed?200:403})
 })
 mountProjectContext({on:(_event,listener)=>{step=listener},systemPrompt:{getContextOrder:()=>0,context:input=>{render=input.text}}},account,'https://cloud.ipollo.net')
 const agent={session:{header:{cwd:path}}}
 let continued=0
 try {
  await linkProject(path,'https://work.ipollo.net','project')
  await step!({agent},async()=>{continued++})
  assert.match(render!({scope:agent}),/Authorized memory/)
  assert.deepEqual(urls,['https://cloud.ipollo.net/api/v1/projects/project/memory'])
  allowed=false
  await assert.rejects(step!({agent},async()=>{continued++}),{code:'PROJECT_FORBIDDEN'})
  assert.equal(render!({scope:agent}),'')
  await linkProject(path,'https://other.test','project')
  await assert.rejects(step!({agent},async()=>{continued++}),{code:'IPW_PROJECT_ACCOUNT_MISMATCH'})
  assert.equal(urls.length,2)
  await unlink(join(path,'.ipollo/project.json'))
  await step!({agent},async()=>{continued++})
  assert.equal(continued,2)
  assert.equal(render!({scope:agent}),'')
 } finally {await rm(path,{recursive:true,force:true})}
})
