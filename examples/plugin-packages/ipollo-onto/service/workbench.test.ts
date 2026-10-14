import { expect, test } from 'bun:test'
import { mkdtemp, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import createService from './workbench.mjs'

test('closed package starts without PostgreSQL or package managers and preserves exact data on restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ipollowork-onto-runtime-'))
  const runtime = { storage: { dataDir }, plugin: { id: 'ipollo-onto', version: '0.1.5' } }
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
