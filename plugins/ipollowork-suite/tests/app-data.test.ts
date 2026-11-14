import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import { AppDataService, appDataRoute, appDataTool, APP_DATA_SKILL } from '../src/host/app-data.ts'
import { AppDataRejection } from '../src/host/errors.ts'
import { createBrowserAppData, AppDataError } from '../src/client/data-service.ts'

const APP = '6f1c2a40-1111-4c2d-9a8b-000000000001'
const detail = {
  id: APP, kind: 'plugin', name: 'Reading list', slug: 'reading-list', workspace: 'Notes', owner: { kind: 'user', id: 'me', name: 'Me' }, public: false,
  collections: 1, records: 1, bytes: 20, canManage: true, createdAt: 1, updatedAt: 2,
  endpoint: `https://account.test/api/data/v1/apps/${APP}/run`, publicKey: 'pk_test',
  limits: { records: 100000, bytes: 67108864, recordBytes: 16384 },
  collectionList: [{ name: 'books', fields: { title: 'text' }, public: [], unique: null, records: 1, bytes: 20 }],
}
const book = { id: 'b1', title: 'Dune', version: 1, createdAt: 1, updatedAt: 1 }

function fixture(signedIn = true) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const account = new AccountService({
    readRecord: async () => (signedIn ? { kind: 'grant', payload: { version: 1, origin: 'https://account.test', token: 'test-token' } } : undefined),
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  }, resolveConfig({ accountOrigin: 'https://account.test' }), new AbortController().signal, async (input, init) => {
    const path = new URL(String(input)).pathname
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init?.method ?? 'GET', path, body })
    if (path === '/api/v1/me/orgs') return json({ items: [{ id: 'org-1', name: 'Acme', role: 'member' }] })
    if (path === '/api/data/v1/apps' && init?.method === 'POST') return json({ app: detail, created: true }, 201)
    if (path === '/api/data/v1/apps') return json({ items: [detail], organizations: [{ id: 'org-1', name: 'Acme' }] })
    if (path.endsWith('/run')) {
      if ('update' in body) return json({ error: '字段 title 是文本，不能写入数字', code: 'DATA_FIELD_TYPE' }, 400)
      if ('insert' in body || 'get' in body || 'upsert' in body) return json({ item: book })
      if ('find' in body) return json({ items: [book], next: null })
      if ('count' in body) return json({ count: 1 })
      return json({ deleted: true })
    }
    if (init?.method === 'DELETE') return json({ deleted: true })
    return json({ app: detail })
  })
  return { calls, service: new AppDataService(account) }
}

test('plugins open an app by name and use collection helpers that send JSON statements', async () => {
  const { calls, service } = fixture()
  const app = await service.open('Reading list', { organization: 'acme' })
  assert.deepEqual(calls.at(-1), { method: 'POST', path: '/api/data/v1/apps', body: { name: 'Reading list', kind: 'plugin', enterpriseId: 'org-1' } })
  const books = app.collection('books')
  assert.equal((await books.insert({ title: 'Dune' })).title, 'Dune')
  assert.deepEqual(calls.at(-1)?.body, { insert: 'books', values: { title: 'Dune' } })
  assert.equal((await books.find({ where: { title: 'Dune' }, limit: 5 })).items.length, 1)
  assert.deepEqual(calls.at(-1)?.body, { find: 'books', where: { title: 'Dune' }, limit: 5 })
  assert.equal(await books.count(), 1)
  await books.upsert('today', { plan: 'legs' })
  assert.deepEqual(calls.at(-1)?.body, { upsert: 'books', id: 'today', values: { plan: 'legs' } })
  await books.delete('b1', 1)
  assert.deepEqual(calls.at(-1)?.body, { delete: 'books', id: 'b1', version: 1 })
  await assert.rejects(books.update('b1', { title: 3 }), (error: unknown) =>
    error instanceof AppDataRejection && error.code === 'DATA_FIELD_TYPE' && error.reason.includes('不能写入数字') && error.status === 400)
  await assert.rejects(service.open('x', { organization: 'Elsewhere' }), (error: unknown) =>
    error instanceof AppDataRejection && error.code === 'IPW_ORGANIZATION_NOT_FOUND' && error.reason.includes('Acme'))
})

test('the app_data tool opens the app for the session workspace and runs the statement', async () => {
  const { calls, service } = fixture()
  const tool = appDataTool(service, cwd => (cwd === '/work/site' ? 'Studio site' : undefined))
  assert.equal(tool.name, 'app_data')
  const value = await tool.execute(
    { app: 'Studio site', kind: 'site', statement: { insert: 'books', values: { title: 'Dune' } } },
    { agent: { session: { header: { cwd: '/work/site' } } } } as never,
  )
  assert.deepEqual(value, { item: book })
  assert.deepEqual(calls.find(call => call.path === '/api/data/v1/apps')?.body, { name: 'Studio site', kind: 'site', workspace: 'Studio site' })
  const kind = (statement: object) => (tool.presentCall?.({ app: 'Studio site', kind: 'site', statement }) as { kind?: string } | undefined)?.kind
  assert.equal(kind({ find: 'books' }), 'read')
  assert.equal(kind({ insert: 'books', values: {} }), 'edit')
  await assert.rejects(tool.execute({ app: 'Studio site', statement: {} }, {} as never), 'kind is required')
  const before = calls.length
  await assert.rejects(tool.execute({ app: 'Unknown app', kind: 'plugin', statement: { info: true } }, {} as never), (error: unknown) =>
    error instanceof AppDataRejection && error.code === 'DATA_APP_NOT_FOUND' && error.reason.includes('Reading list (plugin)'))
  assert.equal(calls.slice(before).some(call => call.method === 'POST'), false, 'reading an unknown app creates nothing')
  await tool.execute({ app: 'reading list', kind: 'plugin', statement: { batch: [{ count: 'books' }] } }, {} as never)
  assert.deepEqual([calls.at(-1)?.path, calls.at(-1)?.body], [`/api/data/v1/apps/${APP}/run`, { batch: [{ count: 'books' }] }], 'a read batch reaches the existing app by name, ignoring letter case')
  const signedOut = appDataTool(fixture(false).service, () => undefined)
  await assert.rejects(signedOut.execute({ app: 'x', kind: 'plugin', statement: { info: true } }, {} as never), (error: unknown) =>
    error instanceof Error && error.message.includes('not signed in to iPolloWork'))
  assert.ok(APP_DATA_SKILL.content.length < 8192, 'the skill stays below the result pruning threshold')
})

test('the Data page routes list, describe, query and delete apps', async () => {
  const { calls, service } = fixture()
  assert.equal(((await appDataRoute(service, 'GET', '', async () => undefined)) as { items: unknown[] }).items.length, 1)
  assert.equal(((await appDataRoute(service, 'GET', `/${APP}`, async () => undefined)) as { app: { id: string } }).app.id, APP)
  assert.deepEqual(await appDataRoute(service, 'POST', `/${APP}/run`, async () => ({ count: 'books' })), { count: 1 })
  assert.equal(((await appDataRoute(service, 'POST', '', async () => ({ name: 'Fitness coach' }))) as { app: { id: string } }).app.id, APP)
  assert.deepEqual(calls.at(-1)?.body, { name: 'Fitness coach', kind: 'plugin' }, 'browser plugins always open plugin apps')
  await assert.rejects(appDataRoute(service, 'POST', '', async () => ({ name: 'x', kind: 'site' })), 'the route accepts only name and organization')
  assert.deepEqual(await appDataRoute(service, 'DELETE', `/${APP}`, async () => undefined), { deleted: true })
  assert.equal(calls.at(-1)?.method, 'DELETE')
  await assert.rejects(appDataRoute(service, 'GET', '/not-an-id', async () => undefined), { code: 'IPW_NOT_FOUND' })
  await assert.rejects(appDataRoute(service, 'PUT', `/${APP}`, async () => undefined), { code: 'IPW_NOT_FOUND' })
})

test('plugin Client modules open apps through the browser service with the Host contract', async (t) => {
  const sent: { url: string; body: unknown }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    sent.push({ url, body })
    if (url.endsWith('/data/apps')) return Response.json({ app: { id: APP } })
    if ('update' in body) return Response.json({ error: 'DATA_FIELD_UNKNOWN', message: '集合 workouts 没有字段 kg；已有字段：reps（数字）' }, { status: 400 })
    return Response.json({ item: { id: 'today', plan: 'legs', version: 1, createdAt: 1, updatedAt: 1 } })
  })
  const app = await createBrowserAppData().open('Fitness coach', { organization: 'Acme' })
  assert.deepEqual(sent[0], { url: '/ipollowork-suite/data/apps', body: { name: 'Fitness coach', organization: 'Acme' } })
  assert.equal((await app.collection('plans').upsert('today', { plan: 'legs' })).plan, 'legs')
  assert.deepEqual(sent[1], { url: `/ipollowork-suite/data/apps/${APP}/run`, body: { upsert: 'plans', id: 'today', values: { plan: 'legs' } } })
  await assert.rejects(app.collection('workouts').update('w1', { kg: 3 }), (error: unknown) =>
    error instanceof AppDataError && error.code === 'DATA_FIELD_UNKNOWN' && error.message.includes('已有字段'))
})
