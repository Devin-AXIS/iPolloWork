import { expect, test } from 'bun:test'
import { mkdtemp, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import createService from './workbench.mjs'

test('closed package starts without PostgreSQL or package managers and preserves exact data on restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ipollowork-onto-runtime-'))
  const runtime = { storage: { dataDir }, plugin: { id: 'ipollo-onto', version: '0.1.6' } }
  const originalPath = process.env.PATH
  process.env.PATH = ''
  let service = createService(runtime)
  const request = async (path: string, body?: unknown) => {
    const response = await fetch('http://127.0.0.1:5711/api' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`)
    expect(response.ok).toBe(true)
    return result
  }
  try {
    const [a, b] = await Promise.all([service.actions['open-workbench'](), service.actions['open-workbench']()])
    expect(a).toEqual(b)
    expect((await request('/health')).database).toMatch(/^SQLite /)
    const other = createService({ ...runtime, storage: { dataDir: await mkdtemp(join(tmpdir(), 'onto-other-instance-')) } })
    try { await expect(other.actions['open-workbench']()).rejects.toThrow('端口') }
    finally { await other.dispose() }
    expect((await request('/health')).ok).toBe(true)
    const project = await request('/projects', { name: '安装即用验证' })
    expect(project.storage.engine).toBe('sqlite')
    const table = await request(`/projects/${project.id}/tables`, { name: '客户' })
    const schema = await request(`/tables/${table.id}/records`)
    const amount = await request(`/tables/${table.id}/fields`, { name: '金额', type: 'number' })
    await request(`/tables/${table.id}/records`, { values: {
      [schema.fields[0].id]: 'SQLite 客户', [amount.id]: '99999999999999.9999',
    } })
    expect((await request(`/tables/${table.id}/records`)).records[0].values[amount.id]).toBe('99999999999999.9999')
    const client = new Client({ name: 'onto-closed-package', version: '1.0.0' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:5711/api/projects/${project.id}/mcp`)))
      const context = await client.callTool({ name: 'data_context', arguments: {} })
      expect(JSON.stringify(context.structuredContent)).toContain(table.id)
      expect(context.isError).not.toBe(true)
    } finally { await client.close() }
    await service.dispose()
    await access(join(dataDir, 'onto.sqlite'))
    service = createService(runtime)
    await service.actions['open-workbench']()
    const retained = await request(`/tables/${table.id}/records`)
    expect(retained.records[0].values[amount.id]).toBe('99999999999999.9999')
    expect(retained.records[0].values[schema.fields[0].id]).toBe('SQLite 客户')
    const html = await fetch('http://127.0.0.1:5711/').then(r => r.text())
    expect(html).toContain('iPollo Onto')
  } finally { await service.dispose(); process.env.PATH = originalPath }
}, 30000)

const desktopRequire = createRequire(resolve(import.meta.dir, '../../../../apps/desktop/package.json'))
let electron = process.env.IPOLLOWORK_ONTO_TEST_ELECTRON ?? ''
if (!electron) { try { electron = desktopRequire('electron') } catch {} }
test.skipIf(!electron || !existsSync(electron))('Electron host starts the closed SQLite package with an empty PATH', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ipollowork-onto-electron-'))
  const serviceUrl = pathToFileURL(resolve(import.meta.dir, '../dist/package/service/workbench.mjs')).href
  const script = `
    import createService from ${JSON.stringify(serviceUrl)};
    delete process.env.ELECTRON_RUN_AS_NODE;
    const service = createService({storage:{dataDir:${JSON.stringify(dataDir)}}});
    try {
      const opened = await service.actions['open-workbench']();
      const health = await fetch(opened.url + 'api/health').then(r => r.json());
      const page = await fetch(opened.url).then(r => r.text());
      if (!health.ok || !health.database.startsWith('SQLite ') || !page.includes('iPollo Onto')) throw new Error('Workbench not ready');
      console.log('electron-sqlite-ready');
    } finally { await service.dispose(); }
  `
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(electron, ['--input-type=module', '-e', script], {
      windowsHide: true, env: { ...process.env, PATH: '', ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Electron test timed out')); }, 15000)
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  expect(result.output).toContain('electron-sqlite-ready')
  expect(result.code).toBe(0)
  await access(join(dataDir, 'onto.sqlite'))
}, 20000)
