import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { linkProject, linkedProjectWorkspaces } from '../src/host/project-context.ts'
import { memberProjectAccess } from '../src/shared/project-access.ts'
import type { EnterpriseDetail } from '../src/shared/enterprise.ts'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import { EnterpriseService } from '../src/host/enterprise.ts'

test('member editor preserves current effective legacy roles without retaining department or everyone grants', () => {
  const members = [
    { userId:'a', departmentId:'engineering' }, { userId:'b', departmentId:null }, { userId:'c', departmentId:null },
  ] as EnterpriseDetail['members']
  const original = { mode:'enterprise' as const, grants:[
    { kind:'department' as const, subjectId:'engineering', role:'participate' as const },
    { kind:'member' as const, subjectId:'a', role:'view' as const },
    { kind:'member' as const, subjectId:'b', role:'maintain' as const },
  ] }
  assert.deepEqual(memberProjectAccess(original, members), { mode:'selected', grants:[
    { kind:'member', subjectId:'a', role:'participate' },
    { kind:'member', subjectId:'b', role:'maintain' },
    { kind:'member', subjectId:'c', role:'view' },
  ] })
  assert.equal(original.mode, 'enterprise')
  assert.equal(original.grants[0]!.kind, 'department')
  assert.deepEqual(memberProjectAccess({ mode:'selected', grants:[] }, members), { mode:'selected', grants:[] })
})

test('linked workspaces expose current local counts only after cloud authorization, with origin and project isolation', async () => {
  const path = await mkdtemp(join(tmpdir(), 'ipw-project-workspace-'))
  const origin = 'https://cloud.ipollo.net', calls:string[] = []
  let allowed = true
  const workspace = { id:'local', title:'My local work', path, sessionIds:['local-chat'] }
  const account = new AccountService({
    readRecord:async()=>({kind:'grant',payload:{version:1,origin,token:'private-fixture'}}),
    modifyRecord:async()=>{},deleteRecord:async()=>{},
  },resolveConfig({accountOrigin:origin}),new AbortController().signal,async input=>{
    calls.push(new URL(String(input)).pathname)
    return Response.json(allowed ? {project:{id:'project'}} : {code:'PROJECT_FORBIDDEN'},{status:allowed ? 200 : 403})
  })
  let localReads = 0
  const bridge = new EnterpriseService(account, {
    workspaceRegistry:{list:()=>{localReads++; return [workspace]}},sessionQuery:{readSurface:async()=>({events:[]})},
  },origin)
  try {
    await linkProject(path,'https://work.ipollo.net','project')
    assert.deepEqual(await bridge.request('GET','/projects/project/local-workspaces'),{items:[{id:'local',title:'My local work',sessionCount:1}]})
    workspace.sessionIds.push('second-chat')
    assert.deepEqual(await bridge.request('GET','/projects/project/local-workspaces'),{items:[{id:'local',title:'My local work',sessionCount:2}]})
    assert.deepEqual(await linkedProjectWorkspaces([workspace],origin,'other'),[])
    assert.deepEqual(await linkedProjectWorkspaces([workspace],'https://other.test','project'),[])
    allowed = false
    const before = localReads
    await assert.rejects(bridge.request('GET','/projects/project/local-workspaces'),{code:'PROJECT_FORBIDDEN'})
    assert.equal(localReads,before)
    assert(calls.every(path=>path === '/api/v1/projects/project/space'))
  } finally { await rm(path,{recursive:true,force:true}) }
})
