import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import { EnterpriseService } from '../src/host/enterprise.ts'
import { organizationTemplateSource } from '../src/client/organization-templates.ts'

test('publication labels survive the Design source and Host bridge without loosening plugin versions', async t => {
  const origin = 'https://account.test', label = '2026-11 初版', paths: string[] = []
  let published = label
  let grant = true
  const account = new AccountService({
    readRecord: async () => ({ kind:'grant',payload:{version:1,origin,token:'test-session'} }),
    modifyRecord:async()=>undefined,deleteRecord:async()=>{},
  },resolveConfig({accountOrigin:origin}),new AbortController().signal,async (input, init)=>{
    const path = new URL(String(input)).pathname
    paths.push(path)
    if (path.endsWith('/me/organization-templates')) return Response.json({items:grant ? [{id:'resource',enterpriseId:'team',title:'Template',description:'Team template',version:published,sourceName:'Team'}] : []})
    if (init?.method === 'POST') return Response.json({id:'resource',version:JSON.parse(String(init.body)).version})
    if (init?.method === 'PUT') return Response.json({ok:true})
    if (path.endsWith('/versions')) return Response.json({items:[{version:label,status:'approved',note:'',created_at:1}]})
    return grant ? Response.json({html:'<h1>Template</h1>'}) : Response.json({code:'RESOURCE_FORBIDDEN'}, {status:403})
  })
  const bridge = new EnterpriseService(account,{workspaceRegistry:{list:()=>[]},sessionQuery:{readSurface:async()=>({events:[]})}},origin)
  assert.equal((await bridge.request('GET','/design-templates') as {items:{version:string}[]}).items[0]?.version,label)
  const release = '/organizations/team/publications/template/resource/versions/' + encodeURIComponent(label)
  await bridge.request('GET','/organizations/team/publications/template/resource/versions')
  await bridge.request('PUT',release,{decision:'publish'})
  assert.deepEqual(await bridge.request('GET','/design-templates/team/resource/'+encodeURIComponent(label)),{html:'<h1>Template</h1>'})
  assert.equal(paths.at(-1),'/api/v1/enterprises/team/publications/template/resource/versions/'+encodeURIComponent(label))
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    try { return Response.json(await bridge.request('GET', path.replace('/ipollowork-suite/enterprise', ''))) }
    catch (error) {
      const { code, status } = error as { code: string; status: number }
      return Response.json({ error: code }, { status })
    }
  })
  const lifetime = new AbortController()
  const source = organizationTemplateSource(lifetime.signal, 'Organization')
  const [entry] = await source.list()
  assert.ok(entry)
  assert.match(entry.version, /^0\.0\.0-org\.[a-f0-9]{48}$/)
  assert.equal((await source.list())[0]?.version, entry.version)
  assert.equal(await source.read(entry.id, entry.version), '<h1>Template</h1>')
  assert.equal(paths.at(-1),'/api/v1/enterprises/team/publications/template/resource/versions/'+encodeURIComponent(label))
  grant = false
  await assert.rejects(source.read(entry.id, entry.version), {code:'RESOURCE_FORBIDDEN'})
  grant = true
  published = '1.2.3'
  assert.equal((await source.list())[0]?.version, published)
  await assert.rejects(source.read(entry.id, entry.version), {message:'IPW_INVALID_INPUT'})
  assert.equal(await source.read(entry.id, published), '<h1>Template</h1>')
  lifetime.abort()
  await assert.rejects(source.read(entry.id, published), {name:'AbortError'})
  const before = paths.length
  await assert.rejects(bridge.request('POST','/organizations/team/publications/plugin',{title:'Plugin',description:'Team plugin',packageName:'@team/plugin',version:label}),{code:'PUBLICATION_VERSION_INVALID'})
  for (const value of ['x%252Fy','%ZZ','..'])
    await assert.rejects(bridge.request('GET','/design-templates/team/resource/'+value))
  assert.equal(paths.length,before)
})

test('service address and code join the active organization service with the existing account grant', async () => {
  const origin = 'https://account.test'
  const paths: string[] = []
  const token = 'q'.repeat(43)
  const account = new AccountService({
    readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin, token: 'test-session' } }),
    modifyRecord: async () => undefined,
    deleteRecord: async () => {},
  }, resolveConfig({accountOrigin:origin}), new AbortController().signal, async (input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-session')
    paths.push(String(input))
    return Response.json({enterpriseId:'existing-organization'})
  })
  const enterprise = new EnterpriseService(account,{
    workspaceRegistry:{list:()=>[]},sessionQuery:{readSurface:async()=>({events:[]})},
  },origin)
  await assert.rejects(enterprise.request('POST','/join',{
    invitation:token,serviceAddress:'https://another.test',
  }),{code:'IPW_INVITATION_SERVICE_MISMATCH'})
  assert.deepEqual(paths,[])
  assert.deepEqual(await enterprise.request('POST','/join',{invitation:token,serviceAddress:origin + '/'}),{enterpriseId:'existing-organization'})
  assert.deepEqual(paths,[origin + '/api/v1/invitations/' + token + '/accept'])
  await assert.rejects(enterprise.request('GET','/os',undefined),{code:'IPW_NOT_FOUND'})
})

test('organization file packages retain the authorized account-service routes', async () => {
  const host = 'https://account.test'
  const calls: string[] = []
  const asset = { id: 'old', title: 'Files', description: '', fileCount: 1, bytes: 10, updatedAt: 1,
    audience: { all: false, members: [], departments: [] } }
  const account = new AccountService({
    readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: host, token: 'test-token' } }),
    modifyRecord: async () => undefined,
    deleteRecord: async () => {},
  }, resolveConfig({ accountOrigin: host }), new AbortController().signal, async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push((init?.method ?? 'GET') + ' ' + path)
    if (path.endsWith('/assets')) return Response.json({ canManage: true, skills: [], packages: [asset] })
    if (init?.method === 'DELETE') return Response.json({ ok: true })
    return Response.json({ package: asset, files: [{ id: 'file', name: 'notes.txt' }] })
  })
  const enterprise = new EnterpriseService(account, {
    workspaceRegistry: { list: () => [] }, sessionQuery: { readSurface: async () => ({ events: [] }) },
  }, host)
  assert.deepEqual(await enterprise.request('GET', '/organizations/team/assets'), { canManage: true, skills: [], packages: [asset] })
  assert.deepEqual(await enterprise.request('GET', '/organizations/team/packages/old'), { package: asset, files: [{ id: 'file', name: 'notes.txt' }] })
  assert.deepEqual(await enterprise.request('DELETE', '/organizations/team/packages/old/files/file'), { ok: true })
  assert.deepEqual(calls, ['GET /api/v1/enterprises/team/assets', 'GET /api/v1/enterprises/team/packages/old',
    'DELETE /api/v1/enterprises/team/packages/old/files/file'])
})

test('the MCP list distinguishes an older service from empty, inaccessible, or missing organizations', async () => {
  const host = 'https://account.test'
  const organization = '00000000-0000-4000-8000-000000000001'
  let reply = Response.json({ canManage: true, items: [] })
  const account = new AccountService({
    readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: host, token: 'test-token' } }),
    modifyRecord: async () => undefined,
    deleteRecord: async () => {},
  }, resolveConfig({ accountOrigin: host }), new AbortController().signal, async input => {
    assert.equal(new URL(String(input)).pathname, `/api/v1/enterprises/${organization}/mcp`)
    return reply
  })
  const enterprise = new EnterpriseService(account, {
    workspaceRegistry: { list: () => [] },
    sessionQuery: { readSurface: async () => ({ events: [] }) },
  }, host)
  const readMcp = () => enterprise.request('GET', `/organizations/${organization}/mcp`)

  assert.deepEqual(await readMcp(), { canManage: true, items: [] })
  reply = Response.json({ error: 'Unknown route' }, { status: 404 })
  await assert.rejects(readMcp, { code: 'IPW_ENTERPRISE_MCP_UNAVAILABLE', status: 503 })
  reply = Response.json({ code: 'ENTERPRISE_FORBIDDEN' }, { status: 403 })
  await assert.rejects(readMcp, { code: 'ENTERPRISE_FORBIDDEN', status: 403 })
  reply = Response.json({ code: 'ENTERPRISE_NOT_FOUND' }, { status: 404 })
  await assert.rejects(readMcp, { code: 'ENTERPRISE_NOT_FOUND', status: 404 })
})

test('the desktop opens an authorized website from an earlier account service without persisting cookies', async t => {
  const origin = 'https://account.test'
  const userId = 'existing-user'
  const websiteId = '00000000-0000-4000-8000-000000000001'
  const url = 'https://work.example.com/'
  const target = `/api/v1/enterprises/team/websites/${websiteId}`
  const calls: string[] = []
  const opened: unknown[] = []
  const oldVault = process.env.IPOLLOWORK_DESKTOP_VAULT
  t.after(() => {
    if (oldVault === undefined) delete process.env.IPOLLOWORK_DESKTOP_VAULT
    else process.env.IPOLLOWORK_DESKTOP_VAULT = oldVault
  })
  process.env.IPOLLOWORK_DESKTOP_VAULT = '1'
  for (const [property, value] of Object.entries({ connected: true, send: (message: Record<string, unknown>) => {
    if (message.operation === 'open') opened.push(message.value)
    const grant = JSON.stringify({ version: 1, origin, token: 'test-token' })
    queueMicrotask(() => process.emit('message', { type: 'ipollo-enterprise-desktop-result', id: message.id, ok: true,
      value: message.operation === 'unseal' ? grant : true }, undefined))
    return true
  } })) {
    const original = Object.getOwnPropertyDescriptor(process, property)
    Object.defineProperty(process, property, { value, configurable: true })
    t.after(() => { if (original) Object.defineProperty(process, property, original); else Reflect.deleteProperty(process, property) })
  }
  let desktopStatus = 404, websiteStatus = 200
  const account = new AccountService({
    readRecord: async () => ({ kind: 'grant', payload: { version: 2, origin, sealed: 'fixture-sealed' } }),
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  }, resolveConfig({ accountOrigin: origin }), new AbortController().signal, async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    if (path === '/api/auth/get-session') return Response.json({ user: { id: userId, email: 'member@example.com', name: 'Member' } })
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token')
    if (path === target + '/desktop') {
      if (desktopStatus === 404) return Response.json({ error: 'Unknown route' }, { status: 404 })
      if (desktopStatus === 403) return Response.json({ code: 'ENTERPRISE_FORBIDDEN' }, { status: 403 })
      return Response.json({ userId, enterpriseId: 'team', siteId: websiteId, label: 'Work', url, cookieNames: ['session'] })
    }
    if (path.endsWith('/websites/manage')) {
      const input = JSON.parse(String(init?.body))
      assert.deepEqual(input.items[0], { id: websiteId, label: 'Work', url, departmentId: null, role: null })
      return Response.json({ revision: 2, items: input.items })
    }
    assert.equal(path, target)
    return websiteStatus === 200 ? Response.json({ url }) : Response.json({ code: 'ORGANIZATION_WEBSITE_UNAVAILABLE' }, { status: 404 })
  })
  const enterprise = new EnterpriseService(account, {
    workspaceRegistry: { list: () => [] }, sessionQuery: { readSurface: async () => ({ events: [] }) },
  }, origin)
  const open = () => enterprise.request('POST', `/organizations/team/websites/${websiteId}/open`)
  assert.deepEqual(await open(), { ok: true })
  assert.deepEqual(calls, [target + '/desktop', target, '/api/auth/get-session'])
  assert.deepEqual(opened, [{ userId, enterpriseId: 'team', siteId: websiteId, label: 'work.example.com', url,
    cookieNames: [], accountOrigin: origin }])
  websiteStatus = 404
  await assert.rejects(open(), { code: 'ORGANIZATION_WEBSITE_UNAVAILABLE', status: 404 })
  desktopStatus = 403
  const beforeDenied = calls.length
  await assert.rejects(open(), { code: 'ENTERPRISE_FORBIDDEN', status: 403 })
  assert.deepEqual(calls.slice(beforeDenied), [target + '/desktop'])
  assert.equal(opened.length, 1)
  desktopStatus = 200
  const beforeModern = calls.length
  assert.deepEqual(await open(), { ok: true })
  assert.deepEqual(calls.slice(beforeModern), [target + '/desktop'])
  assert.deepEqual(opened.at(-1), { userId, enterpriseId: 'team', siteId: websiteId, label: 'Work', url,
    cookieNames: ['session'], accountOrigin: origin })
  await enterprise.request('PUT', '/organizations/team/websites/manage', { revision: 1,
    items: [{ id: websiteId, label: 'Work', url, departmentId: null, role: null, cookieNames: [] }] })
})

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
  assert.deepEqual(calls.map(call => call.path).sort(), [
    '/api/auth/get-session', '/api/v1/enterprises', '/api/v1/projects',
  ])
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
