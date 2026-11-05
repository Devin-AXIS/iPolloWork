import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pool, migrate, identifier } from '../src/server/db'
import * as store from '../src/server/store'
import { app } from '../src/server/app'
import { fieldTypes } from '../src/core/fields'
import { Registry } from '../src/core/registry'
import { exampleBlueprint } from '../src/core/blueprint-example'
import { applyBlueprint } from '../src/server/blueprint'
import { changeExtension, getExtensions } from '../src/server/extensions'
import { createRule, changeRule, runAutomations, rulesFor } from '../src/server/automation'
import { importRecords } from '../src/server/import'
import { links, type FieldDef, type TableData } from '../src/core/contracts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { relationGraph, searchGraphRecords } from '../src/server/relations'
import { pluginInstallPath } from '../src/server/plugin-packages'
import { extensionCatalog } from '../src/core/extensions'

const projects: string[] = []

test('graph entry searches stored titles beyond the visible page with bounded results and project isolation', async () => {
  const p = await project(),
    a = await table(p.id),
    b = await table(p.id),
    outside = await table()
  const ta = await title(a.id),
    tb = await title(b.id),
    tx = await title(outside.id)
  for (let i = 0; i < 52; i++)
    await store.saveRecord(a.id, { values: { [ta.id]: `公司${String(i).padStart(3, '0')}` } })
  const baidu = await store.saveRecord(a.id, { values: { [ta.id]: '百度' } })
  const duplicate = await store.saveRecord(b.id, { values: { [tb.id]: '百度' } })
  await store.saveRecord(outside.id, { values: { [tx.id]: '百度外部' } })
  const percent = await store.saveRecord(a.id, { values: { [ta.id]: '%literal' } })
  const underscore = await store.saveRecord(a.id, { values: { [ta.id]: '_literal' } })
  const slash = await store.saveRecord(a.id, { values: { [ta.id]: '\\literal' } })
  const microsoft = await store.saveRecord(a.id, { values: { [ta.id]: 'Microsoft' } })
  const suggestions = await searchGraphRecords(a.id, { query: '' })
  assert.equal(suggestions.records.length, 20)
  assert.equal(suggestions.hasMore, true)
  assert.ok(suggestions.records.every((r) => r.tableId === a.id))
  const result = await searchGraphRecords(a.id, { query: ' 百 ' })
  assert.deepEqual(new Set(result.records.map((r) => r.id)), new Set([baidu, duplicate]))
  assert.equal(result.tables.length, 2)
  assert.ok(!JSON.stringify(result).includes(outside.id))
  assert.deepEqual(
    Object.keys(result.records[0]!).sort(),
    ['id', 'label', 'tableId', 'tableName'].sort(),
  )
  assert.deepEqual(
    (await searchGraphRecords(a.id, { query: '百', tableId: b.id })).records.map((r) => r.id),
    [duplicate],
  )
  for (const [query, expected] of [
    ['%', percent],
    ['_', underscore],
    ['\\', slash],
    ['micro', microsoft],
  ])
    assert.deepEqual(
      (await searchGraphRecords(a.id, { query: query! })).records.map((r) => r.id),
      [expected],
    )
  assert.deepEqual((await searchGraphRecords(a.id, { query: '不存在' })).records, [])
  await assert.rejects(
    searchGraphRecords(a.id, { query: '百', tableId: outside.id }),
    /不在当前搜索范围/,
  )
  assert.equal(
    (await app.request(`http://localhost/api/tables/${a.id}/graph/records?q=${'a'.repeat(81)}`))
      .status,
    400,
  )
  const response = await app.request(
    `http://localhost/api/tables/${a.id}/graph/records?q=${encodeURIComponent('百')}`,
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json()).records.length, 2)
  try {
    await changeExtension('relations', 'disable')
    assert.equal(
      (await app.request(`http://localhost/api/tables/${a.id}/graph/records?q=x`)).status,
      409,
    )
  } finally {
    await changeExtension('relations', 'enable')
  }
})
let pluginDirectory: string
before(async () => {
  pluginDirectory = await mkdtemp(join(tmpdir(), 'ipollo-import-test-'))
  process.env.DATA_PLUGIN_DIR = pluginDirectory
  await migrate()
})
after(async () => {
  try {
    for (const id of projects.reverse()) await store.deleteProject(id)
  } finally {
    await pool.end()
    await rm(pluginDirectory, { recursive: true, force: true })
  }
})

test('plugin import previews without execution, installs immediately and replays without replacing code', async () => {
  const key = `test-${randomUUID()}`
  const manifest = {
    name: `@test/${key}`,
    version: '1.0.0',
    type: 'module',
    ipolloData: {
      id: key,
      name: '导入测试',
      description: 'test',
      protocol: 1,
      categories: ['fields'],
      defaultInstalled: true,
      dependencies: ['core'],
      contributes: { fields: [key] },
      entrypoints: { shared: 'shared.js' },
    },
  }
  const source = `export function activate({fields}) { fields.register({id: '${key}', label: '测试', category: 'extended', storage: 'text', input: 'text', validate: v => String(v).toUpperCase(), format: v => String(v)}) }`
  const upload = (code = source) => ({
    files: [
      {
        name: 'package.json',
        contentBase64: Buffer.from(JSON.stringify(manifest)).toString('base64'),
      },
      { name: 'shared.js', contentBase64: Buffer.from(code).toString('base64') },
    ],
  })
  const post = (path: string, body: unknown) =>
    app.request(`http://localhost/api/extensions/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const preview = await post('import/preview', upload())
  assert.equal(preview.status, 200)
  assert.equal(fieldTypes.has(key), false)
  await assert.rejects(access(pluginInstallPath(key)))
  const confirmed = await post('import', upload())
  assert.equal(confirmed.status, 200, await confirmed.clone().text())
  const state = (await getExtensions()).find((e) => e.id === key)!
  assert.ok(state.enabled)
  assert.equal(state.defaultInstalled, false)
  assert.equal(fieldTypes.get(key).validate('code', { name: '测试', options: [] }), 'CODE')
  const importedTable = await table()
  const importedField = await field(importedTable.id, { name: '插件字段', type: key })
  const saved = await store.saveRecord(importedTable.id, {
    values: { [importedField.id]: 'persisted' },
  })
  assert.equal((await record(importedTable.id, saved)).values[importedField.id], 'PERSISTED')
  await access(pluginInstallPath(key))
  const asset = await app.request(
    `http://localhost/api/extensions/${key}/assets/shared.js?v=${state.digest}`,
  )
  assert.equal(await asset.text(), source)
  assert.equal((await post('import', upload())).status, 200)
  assert.equal(extensionCatalog.filter((e) => e.id === key).length, 1)
  assert.equal((await post('import', upload(source + '\n// different'))).status, 409)
  const brokenId = `broken-${randomUUID()}`
  manifest.ipolloData.id = brokenId
  manifest.ipolloData.contributes.fields = [brokenId]
  const brokenSource = source
    .replaceAll(key, brokenId)
    .replace('}) }', `}); throw new Error('activation failed') }`)
  assert.equal((await post('import/preview', upload(brokenSource))).status, 200)
  assert.equal((await post('import', upload(brokenSource))).status, 400)
  assert.equal(fieldTypes.has(brokenId), false)
  assert.equal(
    extensionCatalog.some((e) => e.id === brokenId),
    false,
  )
  await assert.rejects(access(pluginInstallPath(brokenId)))
  assert.equal(
    (await pool.query('SELECT id FROM iw_data.extension_state WHERE id=$1', [brokenId])).rowCount,
    0,
  )
  assert.equal(
    (await post('import/preview', { files: [{ name: '../outside.js', contentBase64: '' }] }))
      .status,
    400,
  )
  assert.equal(
    (await post('import', { files: [upload().files[0], upload().files[0]] })).status,
    400,
  )
})
async function project() {
  const p = await store.createProject(
    store.projectInput.parse({ name: `自动验证-${randomUUID()}` }),
  )
  projects.push(p.id)
  return p
}
async function table(projectId?: string) {
  return store.createTable(
    projectId ?? (await project()).id,
    store.tableInput.parse({ name: `表-${randomUUID()}` }),
  )
}
async function field(tableId: string, input: Record<string, unknown>): Promise<FieldDef> {
  const result = await store.createField(tableId, store.fieldInput.parse(input))
  assert.ok(result)
  return result
}
async function title(tableId: string) {
  return (await store.getData(tableId)).fields[0]!
}
async function record(tableId: string, id: string) {
  const value = (await store.getData(tableId)).records.find((r) => r.id === id)
  assert.ok(value)
  return value
}

async function mcpClient(path: string) {
  const client = new Client({ name: 'ipollo-data-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost/api${path}/mcp`), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
  })
  await client.connect(transport)
  return client
}

test('graph and MCP traverse canonical edges, preserve scope and reflect edits and unlinking', async () => {
  const p = await project(),
    a = await table(p.id),
    b = await table(p.id),
    outside = await table()
  const name = await title(b.id)
  const relation = await field(a.id, {
    name: '客户',
    type: 'relation',
    targetTableId: b.id,
    reverseName: '业务',
  })
  const hidden = await field(a.id, {
    name: '外部',
    type: 'relation',
    targetTableId: outside.id,
    reverseName: '外部反向',
  })
  const target = await store.saveRecord(b.id, { values: { [name.id]: '客户甲' } })
  const external = await store.saveRecord(outside.id, { values: {} })
  const source = await store.saveRecord(a.id, {
    values: { [relation.id]: [target], [hidden.id]: [external] },
  })
  let graph = await relationGraph(a.id)
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.edges.length, 1)
  assert.ok(!JSON.stringify(graph).includes(external))
  const inverse = (await store.getTableSchema(b.id)).fields.find(
    (f) => f.relationId === relation.relationId,
  )!
  assert.deepEqual(graph.edges[0]!.sourceField, { id: relation.id, name: '客户', multiple: false })
  assert.deepEqual(graph.edges[0]!.targetField, { id: inverse.id, name: '业务', multiple: true })
  const reverse = await relationGraph(b.id, { recordId: target })
  assert.deepEqual(reverse.edges, graph.edges)
  assert.equal(reverse.nodes.find((n) => n.id === target)?.root, true)
  assert.deepEqual((await relationGraph(a.id, { seedIds: [target] })).nodes, [])
  await assert.rejects(relationGraph(a.id, { recordId: target }), /记录不存在/)
  const current = await record(b.id, target)
  await store.saveRecord(
    b.id,
    { version: current.version, values: { [name.id]: '客户新名称' } },
    target,
  )
  assert.equal((await relationGraph(a.id)).nodes.find((n) => n.id === target)?.label, '客户新名称')
  const client = await mcpClient(`/projects/${p.id}`)
  try {
    assert.ok(
      (await client.listTools()).tools.some(
        (t) => t.name === 'relation_graph' && t.annotations?.readOnlyHint,
      ),
    )
    const result = await client.callTool({
      name: 'relation_graph',
      arguments: { tableId: a.id, recordId: source },
    })
    assert.ok(JSON.stringify(result.structuredContent).includes('客户新名称'))
    const denied = await client.callTool({
      name: 'relation_graph',
      arguments: { tableId: outside.id },
    })
    assert.equal(denied.isError, true)
  } finally {
    await client.close()
  }
  const row = await record(a.id, source)
  await store.saveRecord(a.id, { version: row.version, values: { [relation.id]: [] } }, source)
  graph = await relationGraph(a.id)
  assert.equal(graph.edges.length, 0)
  assert.equal(graph.nodes.length, 1)
  try {
    await changeExtension('relations', 'disable')
    assert.equal((await app.request(`http://localhost/api/tables/${a.id}/graph`)).status, 409)
  } finally {
    await changeExtension('relations', 'enable')
  }
})

test('graph previews stay bounded and omit bodies, raw JSON and source configuration', async () => {
  const t = await table(),
    primary = await title(t.id)
  await field(t.id, { name: '正文', type: 'longtext' })
  await field(t.id, { name: '原始内容', type: 'json' })
  const text = await field(t.id, { name: '简介', type: 'text' })
  const amount = await field(t.id, { name: '金额', type: 'currency' })
  const enabled = await field(t.id, { name: '已确认', type: 'boolean' })
  const empty = await field(t.id, { name: '可选', type: 'text' })
  await field(t.id, { name: '第五个属性', type: 'text' })
  const id = await store.saveRecord(t.id, {
    values: {
      [primary.id]: '公司'.repeat(120),
      [text.id]: '长简介'.repeat(100),
      [amount.id]: 123.45,
      [enabled.id]: false,
    },
  })
  const graph = await relationGraph(t.id, { recordId: id })
  const node = graph.nodes[0]!
  assert.equal(node.label.length, 180)
  assert.deepEqual(
    node.fields.map((f) => f.id),
    [text.id, amount.id, enabled.id, empty.id],
  )
  assert.equal(node.fields[0]!.value!.length, 140)
  assert.equal(Number(node.fields[1]!.value), 123.45)
  assert.equal(node.fields[2]!.value, 'false')
  assert.equal(node.fields[3]!.value, null)
  assert.ok(node.fields.every((f) => !Object.hasOwn(f, 'source')))
})

test('graph bounds large neighborhoods and handles an empty filtered page', async () => {
  const p = await project(),
    a = await table(p.id),
    b = await table(p.id),
    name = await title(b.id)
  const relation = await field(a.id, {
    name: '关联',
    type: 'relation',
    targetTableId: b.id,
    reverseName: '反向',
    multiple: true,
    inverseMultiple: true,
  })
  const imported = await importRecords(b.id, {
    requestId: randomUUID(),
    keyFieldId: name.id,
    rows: Array.from({ length: 200 }, (_, i) => ({ [name.id]: `目标-${i}` })),
  })
  const ids: string[] = imported.ids
  assert.equal(ids.length, 200)
  for (let i = 0; i < 3; i++) await store.saveRecord(a.id, { values: { [relation.id]: ids } })
  const graph = await relationGraph(a.id)
  assert.ok(graph.limited)
  assert.ok(graph.nodes.length <= 200)
  assert.ok(graph.edges.length <= 400)
  const visible = new Set(graph.nodes.map((n) => n.id))
  assert.ok(graph.edges.every((e) => visible.has(e.source) && visible.has(e.target)))
  const empty = await app.request(`http://localhost/api/tables/${a.id}/graph?seedIds=`)
  assert.equal(empty.status, 200)
  assert.deepEqual((await empty.json()).nodes, [])
  const many = await app.request(
    `http://localhost/api/tables/${a.id}/graph?seedIds=${ids.slice(0, 51).join(',')}`,
  )
  assert.equal(many.status, 400)
})

test('scoped API exposes real schema and omits out-of-scope relations on reads and writes', async () => {
  const p = await project(),
    a = await table(p.id),
    b = await table(p.id),
    outside = await table()
  const name = await title(a.id)
  const internal = await field(a.id, {
    name: '项目内关联',
    type: 'relation',
    targetTableId: b.id,
    reverseName: '反向',
  })
  const external = await field(a.id, {
    name: '项目外关联',
    type: 'relation',
    targetTableId: outside.id,
    reverseName: '外部反向',
  })
  const bId = await store.saveRecord(b.id, { values: {} })
  const outsideId = await store.saveRecord(outside.id, { values: {} })
  const row = await store.saveRecord(a.id, {
    values: { [name.id]: '范围测试', [internal.id]: [bId], [external.id]: [outsideId] },
  })
  const get = (path: string) => app.request(`http://localhost/api${path}`)
  const post = (path: string, body: unknown) =>
    app.request(`http://localhost/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const scoped = await (await get(`/projects/${p.id}/context`)).json()
  assert.equal(scoped.tables.length, 2)
  assert.ok(scoped.capabilities.fieldTypes.some((f: { id: string }) => f.id === 'text'))
  assert.ok(!JSON.stringify(scoped).includes(outside.id))
  assert.ok(
    scoped.tables
      .find((t: { id: string }) => t.id === a.id)
      .fields.some((f: FieldDef) => f.id === internal.id),
  )
  const single = await (await get(`/tables/${a.id}/context`)).json()
  assert.equal(single.tables.length, 1)
  assert.equal(single.tables[0].omittedRelationFields, 2)
  const listed = await (await post(`/tables/${a.id}/operations/records_list`, {})).json()
  assert.deepEqual(listed.records[0].values, { [name.id]: '范围测试' })
  assert.equal(
    (await post(`/projects/${p.id}/operations/records_list`, { tableId: outside.id })).status,
    404,
  )
  assert.equal(
    (await post(`/tables/${a.id}/operations/records_list`, { tableId: b.id })).status,
    400,
  )
  assert.equal(
    (await post(`/tables/${a.id}/operations/record_get`, { recordId: outsideId })).status,
    404,
  )
  assert.equal(
    (
      await post(`/tables/${a.id}/operations/record_update`, {
        recordId: row,
        version: 1,
        values: { [external.id]: [] },
      })
    ).status,
    400,
  )
  assert.equal(links((await record(a.id, row)).values[external.id]).length, 1)
  const info = await (await get(`/tables/${a.id}/integration`)).json()
  assert.ok(info.instructions.includes(name.id))
  assert.ok(!info.tools.some((t: { name: string }) => t.name === 'schema_apply'))
  const openapi = await (await get(`/tables/${a.id}/openapi.json`)).json()
  assert.equal(openapi.openapi, '3.1.0')
  const inputSchema =
    openapi.paths[`/api/tables/${a.id}/operations/records_list`].post.requestBody.content[
      'application/json'
    ].schema
  assert.ok(!('tableId' in inputSchema.properties))
  assert.equal(
    (
      await post(`/projects/${p.id}/operations/field_create`, {
        tableId: a.id,
        input: {
          name: '禁止外部关联',
          type: 'relation',
          targetTableId: outside.id,
          reverseName: '拒绝',
        },
      })
    ).status,
    400,
  )
})

test('official MCP client discovers schema, writes by version and replays idempotent imports', async () => {
  const p = await project(),
    t = await table(p.id),
    name = await title(t.id)
  const client = await mcpClient(`/tables/${t.id}`)
  try {
    assert.equal(client.getServerVersion()?.name, 'ipollo-data')
    const tools = (await client.listTools()).tools
    assert.equal(tools.find((t) => t.name === 'records_list')?.annotations?.readOnlyHint, true)
    assert.equal(tools.find((t) => t.name === 'records_refresh')?.annotations?.readOnlyHint, false)
    assert.ok(!tools.some((t) => t.name === 'schema_apply'))
    const resources = await client.listResources()
    const schema = await client.readResource({ uri: resources.resources[0].uri })
    assert.ok(JSON.stringify(schema).includes(name.id))
    const created = await client.callTool({
      name: 'record_create',
      arguments: { values: { [name.id]: 'MCP 客户' } },
    })
    assert.ok(!created.isError, JSON.stringify(created))
    const rowId = ((created.structuredContent as Record<string, unknown>).result as { id: string })
      .id
    const read = await client.callTool({ name: 'record_get', arguments: { recordId: rowId } })
    const version = (
      (read.structuredContent as Record<string, unknown>).result as { version: number }
    ).version
    const updated = await client.callTool({
      name: 'record_update',
      arguments: { recordId: rowId, version, values: { [name.id]: 'MCP 更新' } },
    })
    assert.ok(!updated.isError, JSON.stringify(updated))
    const conflict = await client.callTool({
      name: 'record_update',
      arguments: { recordId: rowId, version, values: { [name.id]: '过时写入' } },
    })
    assert.equal(conflict.isError, true)
    assert.equal(
      ((conflict.structuredContent as Record<string, unknown>).error as { status: number }).status,
      409,
    )
    assert.equal((await record(t.id, rowId)).values[name.id], 'MCP 更新')
    const input = {
      requestId: randomUUID(),
      keyFieldId: name.id,
      rows: [{ [name.id]: '批量客户' }],
    }
    await client.callTool({ name: 'records_import', arguments: { input } })
    const replay = await client.callTool({ name: 'records_import', arguments: { input } })
    assert.equal(
      ((replay.structuredContent as Record<string, unknown>).result as { replayed: boolean })
        .replayed,
      true,
    )
    assert.equal((await store.getData(t.id)).total, 2)
    const invalid = await client.callTool({
      name: 'record_create',
      arguments: { values: {}, tableId: randomUUID() },
    })
    assert.equal(invalid.isError, true)
  } finally {
    await client.close()
  }
  const url = `http://localhost/api/tables/${t.id}/mcp`
  const blocked = await app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    body: '{}',
  })
  assert.equal(blocked.status, 403)
  assert.equal((await app.request(url)).status, 405)
  assert.equal((await app.request(url, { method: 'DELETE' })).status, 405)
})

test('project MCP previews and builds linked tables without visual interaction', async () => {
  const p = await project(),
    outside = await table()
  const client = await mcpClient(`/projects/${p.id}`)
  try {
    const { project: _project, ...input } = exampleBlueprint(p.id)
    const preview = await client.callTool({ name: 'schema_preview', arguments: input })
    assert.ok(!preview.isError, JSON.stringify(preview))
    assert.equal((await store.getTables(p.id)).length, 0)
    const built = await client.callTool({ name: 'schema_apply', arguments: input })
    assert.ok(!built.isError, JSON.stringify(built))
    assert.equal((await store.getTables(p.id)).length, 2)
    const replay = await client.callTool({ name: 'schema_apply', arguments: input })
    assert.equal(
      ((replay.structuredContent as Record<string, unknown>).result as { replayed: boolean })
        .replayed,
      true,
    )
    // A new HTTP request discovers the schema written by the preceding call.
    const fresh = await client.callTool({ name: 'data_context', arguments: {} })
    assert.equal(
      ((fresh.structuredContent as Record<string, unknown>).result as { tables: unknown[] }).tables
        .length,
      2,
    )
    const rejected = await client.callTool({
      name: 'schema_apply',
      arguments: {
        ...input,
        requestId: randomUUID(),
        relations: [
          {
            from: input.tables[0].key,
            to: outside.id,
            key: 'external',
            name: '外部',
            reverseName: '拒绝',
            targetVersion: 1,
          },
        ],
      },
    })
    assert.equal(rejected.isError, true)
    assert.equal((await store.getTables(p.id)).length, 2)
  } finally {
    await client.close()
  }
})

test('typed records preserve decimal precision, JSON, dates and extension values', async () => {
  const t = await table(),
    name = await title(t.id)
  const money = await field(t.id, { name: '金额', type: 'currency' })
  const json = await field(t.id, { name: '信息', type: 'json' })
  const date = await field(t.id, { name: '日期', type: 'date' })
  const pct = await field(t.id, { name: '进度', type: 'percentage' })
  const id = await store.saveRecord(t.id, {
    values: {
      [name.id]: '客户 A',
      [money.id]: '99999999999999.1234',
      [json.id]: { tags: ['a', '中'], n: 3 },
      [date.id]: '2026-09-10',
      [pct.id]: '42.5',
    },
  })
  const r = await record(t.id, id)
  assert.equal(r.values[money.id], '99999999999999.1234')
  assert.equal(fieldTypes.get('currency').format(r.values[money.id]), '99,999,999,999,999.1234')
  assert.deepEqual(r.values[json.id], { tags: ['a', '中'], n: 3 })
  assert.equal(r.values[date.id], '2026-09-10')
  assert.equal(r.values[pct.id], '42.5')
  await assert.rejects(store.saveRecord(t.id, { values: { [pct.id]: '101' } }), /0 到 100/)
  await assert.rejects(store.saveRecord(t.id, { values: { [date.id]: '2026-02-30' } }))
  assert.equal((await store.getData(t.id)).total, 1)
})

test('cross-project links use one edge and support edits from either direction', async () => {
  const a = await table(),
    b = await table()
  const aTitle = await title(a.id),
    bTitle = await title(b.id)
  const relation = await field(a.id, {
    name: '客户',
    type: 'relation',
    targetTableId: b.id,
    reverseName: '商机',
    multiple: false,
    inverseMultiple: true,
  })
  const reverse = (await store.getData(b.id)).fields.find(
    (f) => f.relationId === relation.relationId,
  )!
  const b1 = await store.saveRecord(b.id, { values: { [bTitle.id]: '客户甲' } })
  const b2 = await store.saveRecord(b.id, { values: { [bTitle.id]: '客户乙' } })
  const a1 = await store.saveRecord(a.id, {
    values: { [aTitle.id]: '商机一', [relation.id]: [b1] },
  })
  assert.deepEqual(
    links((await record(b.id, b1)).values[reverse.id]).map((r) => r.id),
    [a1],
  )
  let own = await record(a.id, a1)
  await store.saveRecord(a.id, { version: own.version, values: { [relation.id]: [b2] } }, a1)
  assert.deepEqual(links((await record(b.id, b1)).values[reverse.id]), [])
  const target = await record(b.id, b2)
  await store.saveRecord(b.id, { version: target.version, values: { [reverse.id]: [] } }, b2)
  own = await record(a.id, a1)
  assert.deepEqual(links(own.values[relation.id]), [])
  const emptyTarget = await record(b.id, b1)
  await store.saveRecord(b.id, { version: emptyTarget.version, values: { [reverse.id]: [a1] } }, b1)
  assert.equal(links((await record(a.id, a1)).values[relation.id])[0]?.id, b1)
  await store.renameTable(b.id, store.tableInput.parse({ name: '改名后的客户表' }))
  assert.equal(links((await record(a.id, a1)).values[relation.id])[0]?.label, '客户甲')
  const count = await pool.query(
    'SELECT count(*)::int AS n FROM iw_data.links WHERE relation_id=$1',
    [relation.relationId],
  )
  assert.equal(count.rows[0].n, 1)
  const latest = await record(b.id, b1)
  await store.deleteRecord(b.id, b1, latest.version)
  assert.deepEqual(links((await record(a.id, a1)).values[relation.id]), [])
})

test('simultaneous one-to-one links allow exactly one writer and roll back the losing record', async () => {
  const a = await table(),
    b = await table()
  const t = await title(a.id)
  const relation = await field(a.id, {
    name: '唯一关联',
    type: 'relation',
    targetTableId: b.id,
    reverseName: '唯一来源',
    inverseMultiple: false,
  })
  const target = await store.saveRecord(b.id, { values: {} })
  const writes = await Promise.allSettled(
    ['甲', '乙'].map((label) =>
      store.saveRecord(a.id, { values: { [t.id]: label, [relation.id]: [target] } }),
    ),
  )
  assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(writes.filter((r) => r.status === 'rejected').length, 1)
  assert.equal((await store.getData(a.id)).total, 1)
  const second = await store.saveRecord(a.id, { values: { [t.id]: '未改变' } })
  const current = await record(a.id, second)
  await assert.rejects(
    store.saveRecord(
      a.id,
      { version: current.version, values: { [t.id]: '不该保存', [relation.id]: [target] } },
      second,
    ),
  )
  assert.equal((await record(a.id, second)).values[t.id], '未改变')
  assert.equal((await record(a.id, second)).version, current.version)
})

test('stale edits, unknown fields and wrong-table targets cannot overwrite or leak records', async () => {
  const a = await table(),
    b = await table(),
    c = await table()
  const t = await title(a.id)
  const relation = await field(a.id, {
    name: '关联',
    type: 'relation',
    targetTableId: b.id,
    reverseName: '来源',
  })
  const id = await store.saveRecord(a.id, { values: { [t.id]: '原始' } })
  await store.saveRecord(a.id, { version: 1, values: { [t.id]: '新值' } }, id)
  await assert.rejects(store.saveRecord(a.id, { version: 1, values: { [t.id]: '旧窗口' } }, id), {
    status: 409,
  })
  await assert.rejects(store.saveRecord(a.id, { values: { [randomUUID()]: '未知' } }), {
    status: 409,
  })
  const wrongTarget = await store.saveRecord(c.id, { values: {} })
  await assert.rejects(
    store.saveRecord(a.id, { values: { [relation.id]: [wrongTarget] } }),
    /其他数据表/,
  )
  assert.equal((await store.getData(a.id)).total, 1)
  assert.equal((await record(a.id, id)).values[t.id], '新值')
})

test('pagination is stable and prefix search treats wildcard characters literally', async () => {
  const t = await table(),
    f = await title(t.id)
  for (let i = 0; i < 55; i++) await store.saveRecord(t.id, { values: { [f.id]: `条目-${i}` } })
  await store.saveRecord(t.id, { values: { [f.id]: '百分%号' } })
  const p1 = await store.getData(t.id, 1),
    p2 = await store.getData(t.id, 2)
  assert.equal(p1.total, 56)
  assert.equal(p1.records.length, 50)
  assert.equal(p2.records.length, 6)
  assert.equal(new Set([...p1.records, ...p2.records].map((r) => r.id)).size, 56)
  assert.equal((await store.getData(t.id, 1, '百分%')).total, 1)
  assert.equal((await store.getData(t.id, 1, '%')).total, 0)
})

test('wide tables exceed 50 fields without PostgreSQL function argument failures', async () => {
  const t = await table()
  for (let i = 0; i < 52; i++) await field(t.id, { name: `字段${i}`, type: 'text' })
  await store.saveRecord(t.id, { values: {} })
  assert.equal(Object.keys((await store.getData(t.id)).records[0]!.values).length, 53)
})

test('field extension contracts reject duplicate registration and invalid values', () => {
  const registry = new Registry<{ id: string }>()
  registry.register({ id: 'first' })
  assert.throws(() => registry.register({ id: 'first' }), /重复扩展/)
  assert.throws(() => registry.get('missing'), /未知扩展/)
  assert.equal(fieldTypes.get('percentage').format('23'), '23%')
  assert.throws(() => fieldTypes.get('percentage').validate('-1', { name: '比例', options: [] }))
})

test('API validates JSON, IDs, local origins and hostnames', async () => {
  const request = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init)
  assert.equal(
    (
      await request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  )
  assert.equal((await request('/api/projects', { method: 'POST', body: '{}' })).status, 415)
  assert.equal(
    (await request('/api/projects', { headers: { Origin: 'https://example.com' } })).status,
    403,
  )
  assert.equal((await app.request('http://attacker.example/api/projects')).status, 403)
  assert.equal((await request('/api/tables/not-a-uuid/records')).status, 400)
  assert.equal((await request('/api/field-types')).status, 200)
  const types = (await (await request('/api/field-types')).json()) as Array<{ id: string }>
  assert.ok(types.some((type) => type.id === 'percentage'))
})

test('business fields validate typed values, empty required choices and time zones', async () => {
  const t = await table()
  const multi = await field(t.id, {
    name: '业务类型',
    type: 'multiselect',
    options: ['销售', '服务'],
    required: true,
  })
  const tags = await field(t.id, { name: '标签', type: 'tags' })
  const dt = await field(t.id, { name: '拜访时间', type: 'datetime' })
  const range = await field(t.id, { name: '服务期间', type: 'daterange' })
  const email = await field(t.id, { name: '邮箱', type: 'email' })
  const rating = await field(t.id, { name: '评分', type: 'rating' })
  const id = await store.saveRecord(t.id, {
    values: {
      [multi.id]: ['销售', '服务'],
      [tags.id]: ['重点', '重点', '新客户'],
      [dt.id]: '2026-09-10T09:00:00+08:00',
      [range.id]: { start: '2026-09-01', end: '2026-09-30' },
      [email.id]: 'hello@example.com',
      [rating.id]: '5',
    },
  })
  const r = await record(t.id, id)
  assert.deepEqual(r.values[multi.id], ['销售', '服务'])
  assert.deepEqual(r.values[tags.id], ['重点', '新客户'])
  assert.equal(r.values[dt.id], '2026-09-10T01:00:00.000Z')
  assert.deepEqual(r.values[range.id], { start: '2026-09-01', end: '2026-09-30' })
  await assert.rejects(store.saveRecord(t.id, { values: { [multi.id]: [] } }), /请填写/)
  for (const [f, value] of [
    [multi, ['错误']],
    [dt, '2026-09-10T09:00'],
    [range, { start: '2026-09-30', end: '2026-09-01' }],
    [email, 'bad'],
    [rating, 6],
  ] as const)
    await assert.rejects(
      store.saveRecord(t.id, { version: r.version, values: { [f.id]: value } }, id),
    )
  assert.equal((await record(t.id, id)).version, r.version)
})

test('AI blueprint preview is disposable, apply is atomic and concurrent replay is idempotent', async () => {
  const b = exampleBlueprint()
  b.project = { name: `自动验证-结构-${randomUUID()}`, description: '' }
  const beforeCount = (await pool.query('SELECT count(*)::int AS n FROM iw_data.projects')).rows[0]
    .n
  const preview = await applyBlueprint(b, true)
  assert.equal(preview.preview, true)
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM iw_data.projects')).rows[0].n,
    beforeCount,
  )
  const [first, second] = await Promise.all([applyBlueprint(b), applyBlueprint(b)])
  projects.push(first.projectId)
  assert.equal(first.projectId, second.projectId)
  assert.equal([first, second].filter((r) => r.replayed).length, 1)
  assert.equal((await store.getTables(first.projectId)).length, 2)
  const relation = (await store.getData(first.tables[1].id)).fields.find(
    (f) => f.type === 'relation',
  )!
  assert.equal(relation.targetTableId, first.tables[0].id)
  const altered = structuredClone(b)
  altered.tables[0].name = '不同内容'
  await assert.rejects(applyBlueprint(altered), /requestId/)
  const bad = exampleBlueprint()
  bad.project = { name: `自动验证-回滚-${randomUUID()}`, description: '' }
  bad.relations[0].reverseName = '客户名称'
  const tableCount = (await pool.query('SELECT count(*)::int AS n FROM iw_data.tables')).rows[0].n
  await assert.rejects(applyBlueprint(bad))
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM iw_data.tables')).rows[0].n,
    tableCount,
  )
  assert.equal(
    (await pool.query('SELECT id FROM iw_data.projects WHERE name=$1', [bad.project.name]))
      .rowCount,
    0,
  )
})

test('AI relations can target another project by ID and reject stale target schemas', async () => {
  const target = await table(),
    projectId = (await project()).id
  const b = exampleBlueprint(projectId)
  b.tables = b.tables.slice(0, 1)
  b.relations = [
    {
      from: 'customers',
      to: target.id,
      targetVersion: target.version,
      key: 'external',
      name: '外部客户',
      reverseName: '客户来源',
      multiple: false,
      inverseMultiple: true,
    },
  ]
  const result = await applyBlueprint(b)
  assert.equal(
    (await store.getData(result.tables[0].id)).fields.find((f) => f.type === 'relation')
      ?.targetTableId,
    target.id,
  )
  b.requestId = randomUUID()
  b.tables[0].name = '第二张表'
  await assert.rejects(applyBlueprint(b), /结构已变化/)
  assert.equal((await store.getTables(projectId)).length, 1)
})

test('extension installation and enablement persist and protect data dependencies', async () => {
  const t = await table()
  await field(t.id, { name: '联系邮箱', type: 'email' })
  try {
    await changeExtension('cards', 'disable')
    assert.equal((await getExtensions()).find((e) => e.id === 'cards')?.enabled, false)
    await changeExtension('cards', 'uninstall')
    await assert.rejects(changeExtension('cards', 'enable'), /先安装/)
    await changeExtension('cards', 'install')
    await pool.query(
      "UPDATE iw_data.extension_state SET installed_version='0.9.0' WHERE id='cards'",
    )
    await changeExtension('cards', 'upgrade')
    assert.equal((await getExtensions()).find((e) => e.id === 'cards')?.installedVersion, '1.0.0')
    await assert.rejects(changeExtension('business-fields', 'uninstall'), /字段/)
    await assert.rejects(changeExtension('core', 'disable'), /基础能力/)
    await assert.rejects(changeExtension('not-installed', 'install'), /发行包/)
  } finally {
    await changeExtension('cards', 'install')
  }
})

test('JSON import upserts by an exact key, replays safely and rolls back invalid batches', async () => {
  const t = await table(),
    key = await title(t.id),
    amount = await field(t.id, { name: '金额', type: 'currency' })
  const first = {
    requestId: randomUUID(),
    keyFieldId: key.id,
    rows: [
      { [key.id]: 'A', [amount.id]: '10.25' },
      { [key.id]: 'B', [amount.id]: '20' },
    ],
  }
  assert.equal((await importRecords(t.id, first)).created, 2)
  assert.equal((await importRecords(t.id, first)).replayed, true)
  const second = await importRecords(t.id, {
    ...first,
    requestId: randomUUID(),
    rows: [{ [key.id]: 'A', [amount.id]: '30' }],
  })
  assert.equal(second.updated, 1)
  assert.equal((await record(t.id, second.ids[0])).values[amount.id], '30')
  await assert.rejects(
    importRecords(t.id, {
      ...first,
      requestId: randomUUID(),
      rows: [
        { [key.id]: 'A', [amount.id]: '99' },
        { [key.id]: 'C', [amount.id]: '错误' },
      ],
    }),
  )
  assert.equal((await record(t.id, second.ids[0])).values[amount.id], '30')
  assert.equal((await store.getData(t.id)).total, 2)
  await store.saveRecord(t.id, { values: { [key.id]: 'A' } })
  await assert.rejects(importRecords(t.id, { ...first, requestId: randomUUID() }), /多条记录/)
})

test('automation runs durably, pauses with its extension and never overwrites filled values', async () => {
  const t = await table(),
    f = await field(t.id, { name: '阶段', type: 'select', options: ['待跟进', '进行中'] })
  const initial = (await getExtensions()).find((e) => e.id === 'automation')!
  await changeExtension('automation', 'install')
  try {
    const rule = await createRule(t.id, { name: '自动设定阶段', fieldId: f.id, value: '待跟进' })
    await changeExtension('automation', 'disable')
    const pending = await store.saveRecord(t.id, { values: {} })
    await runAutomations()
    assert.equal((await record(t.id, pending)).values[f.id], null)
    await changeExtension('automation', 'enable')
    await Promise.all([runAutomations(), runAutomations()])
    assert.equal((await record(t.id, pending)).values[f.id], '待跟进')
    const version = (await record(t.id, pending)).version
    await runAutomations()
    assert.equal((await record(t.id, pending)).version, version)
    const manual = await store.saveRecord(t.id, { values: { [f.id]: '进行中' } })
    await runAutomations()
    assert.equal((await record(t.id, manual)).values[f.id], '进行中')
    assert.equal((await rulesFor(t.id))[0].lastStatus, 'skipped')
    await changeRule(t.id, rule.id, false)
    const paused = await store.saveRecord(t.id, { values: {} })
    await runAutomations()
    assert.equal((await record(t.id, paused)).values[f.id], null)
  } finally {
    await changeExtension('automation', 'disable')
    if (!initial.installedVersion) await changeExtension('automation', 'uninstall')
    else if (initial.enabled) await changeExtension('automation', 'enable')
  }
})

test('machine discovery and command endpoint create schema without browser interaction', async () => {
  const meta = await (await app.request('http://localhost/api/capabilities')).json()
  assert.equal(meta.aiProvider, 'iPolloWork')
  assert.ok(meta.commandSchema.oneOf || meta.commandSchema.anyOf)
  const b = exampleBlueprint()
  b.project = { name: `自动验证-命令-${randomUUID()}`, description: '' }
  const post = (body: unknown) =>
    app.request('http://localhost/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const response = await post({ action: 'schema.apply', input: b })
  assert.equal(response.status, 200)
  const result = await response.json()
  projects.push(result.projectId)
  const data = await (await post({ action: 'schema.get', projectId: result.projectId })).json()
  assert.equal(data.tables.length, 2)
  assert.equal((await post({ action: 'invented.command' })).status, 400)
  const count = (await store.getProjects()).length
  const invalid = await post({
    action: 'schema.apply',
    input: { ...b, requestId: randomUUID(), surprise: true },
  })
  assert.equal(invalid.status, 400)
  assert.equal((await store.getProjects()).length, count)
})

test('automation cursor waits for earlier record transactions before advancing', async () => {
  const t = await table(),
    f = await field(t.id, { name: '处理状态', type: 'text' })
  await changeExtension('automation', 'install')
  const db = await pool.connect()
  try {
    await createRule(t.id, { name: '顺序处理', fieldId: f.id, value: '已处理' })
    await db.query('BEGIN')
    const earlier = await store.saveRecord(t.id, { values: {} }, undefined, db)
    const laterPending = store.saveRecord(t.id, { values: {} })
    const later = pool.dialect === 'sqlite' ? undefined : await laterPending
    let done = false
    const pending = runAutomations().then(() => {
      done = true
    })
    await new Promise((r) => setTimeout(r, 30))
    const blocked = !done
    await db.query('COMMIT')
    await pending
    const laterId = later ?? await laterPending
    assert.equal(blocked, true)
    await runAutomations()
    assert.equal((await record(t.id, earlier)).values[f.id], '已处理')
    assert.equal((await record(t.id, laterId)).values[f.id], '已处理')
  } finally {
    db.release()
    await changeExtension('automation', 'disable')
    await changeExtension('automation', 'uninstall')
  }
})

test('project management validates connections and keeps credentials out of responses', async () => {
  const { testConnection, createManagedProject, projectDatabase, updateProject } =
    await import('../src/server/databases')
  if (pool.dialect === 'sqlite') {
    const created = await createManagedProject({ name: 'SQLite 项目' })
    projects.push(created.id)
    assert.equal(created.storage?.engine, 'sqlite')
    assert.equal((await projectDatabase(created.id)).database, 'onto.sqlite')
    await assert.rejects(testConnection({ host: '127.0.0.1', port: 1, user: 'test', database: 'test' }), /连接/)
    return
  }
  const current = new URL(process.env.DATABASE_URL!)
  const connection = {
    host: current.hostname,
    port: Number(current.port || 5432),
    database: current.pathname.slice(1),
    user: decodeURIComponent(current.username),
    password:
      decodeURIComponent(current.password) ||
      process.env.PGPASSWORD ||
      'verification-secret-do-not-return',
  }
  const checked = await testConnection(connection)
  assert.equal(checked.database, connection.database)
  assert.equal(JSON.stringify(checked).includes(connection.password), false)
  const count = (await store.getProjects()).length
  await assert.rejects(
    createManagedProject({ name: '拒绝重复默认库', database: { mode: 'independent', connection } }),
    /默认数据库/,
  )
  await assert.rejects(
    createManagedProject({
      name: '拒绝错误连接',
      database: { mode: 'independent', connection: { ...connection, port: 1 } },
    }),
    /连接/,
  )
  assert.equal((await store.getProjects()).length, count)
  const p = await project()
  await updateProject(p.id, {
    name: '修改后的项目',
    description: '已连接默认存储',
    color: 'neutral',
  })
  assert.equal((await store.getProjects()).find((x) => x.id === p.id)?.name, '修改后的项目')
  assert.equal((await projectDatabase(p.id)).database, connection.database)
  const response = await app.request(`http://localhost/api/projects/${p.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '不能偷偷切库', database: { mode: 'independent', connection } }),
  })
  assert.equal(response.status, 400)
})

test(
  'independent projects route schema, rows, relations, import and automation to the selected database',
  { skip: !process.env.TEST_PROJECT_DATABASE_URL },
  async () => {
    const pg = await import('pg')
    const {
      createManagedProject,
      deleteManagedProject,
      withProject,
      closeProjectDatabases,
      forEachDatabase,
      listProjects,
    } = await import('../src/server/databases')
    const remote = new pg.default.Pool({ connectionString: process.env.TEST_PROJECT_DATABASE_URL })
    const url = new URL(process.env.TEST_PROJECT_DATABASE_URL!)
    assert.notEqual(
      url.pathname,
      new URL(process.env.DATABASE_URL!).pathname,
      'Independent test database must differ from the default test database',
    )
    const connection = {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password:
        decodeURIComponent(url.password) ||
        process.env.PGPASSWORD ||
        'encrypted-project-test-secret',
    }
    let projectId: string | undefined
    const request = (path: string, body?: unknown, method = 'POST') =>
      app.request(
        `http://localhost/api${path}`,
        body === undefined
          ? undefined
          : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      )
    const post = async (path: string, body: unknown) => {
      const r = await request(path, body)
      const value = await r.json()
      assert.equal(r.status < 300, true, JSON.stringify(value))
      return value
    }
    try {
      const p = await createManagedProject({
        name: '自动验证-独立数据库',
        database: { mode: 'independent', connection },
      })
      projectId = p.id
      assert.equal(p.storage?.database, connection.database)
      const pluginId = `scoped-${randomUUID()}`
      const packageFiles = {
        'package.json': JSON.stringify({
          name: `@test/${pluginId}`,
          version: '1.0.0',
          type: 'module',
          ipolloData: {
            id: pluginId,
            name: '独立库导入测试',
            description: 'test',
            protocol: 1,
            categories: ['views'],
            dependencies: ['core'],
            contributes: { views: [pluginId] },
            entrypoints: { client: 'client.js' },
          },
        }),
        'client.js': `export function activate({views}) { views.register({id: '${pluginId}', name: '测试', component: () => null}) }`,
      }
      const pluginUpload = {
        files: Object.entries(packageFiles).map(([name, content]) => ({
          name,
          contentBase64: Buffer.from(content).toString('base64'),
        })),
      }
      await post(`/extensions/import/preview?projectId=${p.id}`, pluginUpload)
      const installed = await post(`/extensions/import?projectId=${p.id}`, pluginUpload)
      assert.equal(installed.find((e: { id: string }) => e.id === pluginId).enabled, true)
      assert.equal((await getExtensions()).find((e) => e.id === pluginId)?.enabled, false)
      assert.equal(
        (await remote.query('SELECT enabled FROM iw_data.extension_state WHERE id=$1', [pluginId]))
          .rows[0].enabled,
        true,
      )
      const binding = (
        await pool.query('SELECT * FROM iw_data.project_databases WHERE project_id=$1', [p.id])
      ).rows[0]
      assert.equal(binding.ready, true)
      assert.equal(JSON.stringify(binding).includes(connection.password), false)
      assert.equal(
        (await pool.query('SELECT id FROM iw_data.projects WHERE id=$1', [p.id])).rowCount,
        0,
      )
      assert.equal(
        (await remote.query('SELECT id FROM iw_data.projects WHERE id=$1', [p.id])).rowCount,
        1,
      )
      const blueprint = exampleBlueprint(p.id)
      const preview = await post('/commands', { action: 'schema.preview', input: blueprint })
      assert.equal(preview.preview, true)
      assert.equal((await remote.query('SELECT id FROM iw_data.tables')).rowCount, 0)
      const built = await post('/commands', { action: 'schema.apply', input: blueprint })
      const customers = built.tables[0],
        deals = built.tables[1]
      const schema = await post('/commands', { action: 'schema.get', projectId: p.id })
      assert.equal(schema.tables.length, 2)
      assert.equal(
        (await pool.query('SELECT id FROM iw_data.tables WHERE project_id=$1', [p.id])).rowCount,
        0,
      )
      assert.equal(
        (await remote.query('SELECT id FROM iw_data.tables WHERE project_id=$1', [p.id])).rowCount,
        2,
      )
      const data = await (await request(`/tables/${customers.id}/records`)).json()
      const title = data.fields[0].id
      const created = await post(`/tables/${customers.id}/records`, {
        values: { [title]: '独立客户' },
      })
      const documentBase = `/tables/${customers.id}/records/${created.id}/documents`
      const document = await post(documentBase, { title: '独立文档' })
      assert.equal(
        (await remote.query('SELECT id FROM iw_data.documents WHERE id=$1', [document.id]))
          .rowCount,
        1,
      )
      assert.equal(
        (await pool.query('SELECT id FROM iw_data.documents WHERE id=$1', [document.id])).rowCount,
        0,
      )
      const editedDocument = await request(
        `${documentBase}/${document.id}`,
        {
          version: document.version,
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '独立库正文' }] }],
          },
        },
        'PATCH',
      )
      assert.equal(editedDocument.status, 200)
      assert.equal(
        (await (await request(`${documentBase}/${document.id}`)).json()).content.content[0]
          .content[0].text,
        '独立库正文',
      )
      assert.equal((await (await request(`/projects/${p.id}/documents`)).json())[0].id, document.id)
      const relation = (await (await request(`/tables/${deals.id}/records`)).json()).fields.find(
        (f: FieldDef) => f.type === 'relation',
      )
      await post(`/tables/${deals.id}/records`, {
        values: { [relation.id]: [created.id], [deals.fieldIds.name]: '独立商机' },
      })
      const linked = await (await request(`/tables/${customers.id}/records`)).json()
      assert.equal(
        links(
          linked.records[0].values[linked.fields.find((f: FieldDef) => f.type === 'relation').id],
        ).length,
        1,
      )
      const importResult = await post('/commands', {
        action: 'records.import',
        tableId: customers.id,
        input: { requestId: randomUUID(), keyFieldId: title, rows: [{ [title]: '同步客户' }] },
      })
      assert.equal(importResult.created, 1)
      const detailOrder = linked.fields
        .filter((f: FieldDef) => f.type !== 'relation')
        .map((f: FieldDef) => f.id)
        .reverse()
      const detailLayout = await request(
        `/tables/${customers.id}/detail-layout`,
        { fieldOrder: detailOrder, version: linked.table.version },
        'PATCH',
      )
      assert.equal(detailLayout.status, 200)
      const relatedDetail = await (
        await request(
          `/tables/${customers.id}/records/${created.id}/relations/${linked.fields.find((f: FieldDef) => f.type === 'relation').id}`,
        )
      ).json()
      assert.equal(relatedDetail.table.id, deals.id)
      assert.equal(relatedDetail.total, 1)
      await closeProjectDatabases()
      const reopenedDetail = await (
        await request(`/tables/${customers.id}/records?recordId=${created.id}&dynamic=defer`)
      ).json()
      assert.deepEqual(reopenedDetail.table.detailLayout.fieldOrder, detailOrder)
      const local = await table()
      const cross = await request(`/tables/${customers.id}/fields`, {
        name: '错误跨库',
        type: 'relation',
        targetTableId: local.id,
        reverseName: '错误反向',
      })
      assert.equal(cross.status, 404)
      assert.match((await cross.json()).error, /同一数据库/)
      // Concurrent requests must not inherit another request's database scope.
      const concurrent = await Promise.all([
        request(`/tables/${local.id}/records`),
        request(`/tables/${customers.id}/records`),
      ])
      assert.equal((await concurrent[0].json()).total, 0)
      assert.equal((await concurrent[1].json()).total, 2)
      const flag = await post(`/tables/${customers.id}/fields`, { name: '自动状态', type: 'text' })
      await post(`/extensions/automation?projectId=${p.id}`, { action: 'install' })
      await post(`/tables/${customers.id}/automations`, {
        name: '独立库自动化',
        fieldId: flag.id,
        value: '已处理',
      })
      const automatic = await post(`/tables/${customers.id}/records`, {
        values: { [title]: '自动化客户' },
      })
      await forEachDatabase(runAutomations)
      assert.equal(
        (await withProject(p.id, () => store.getData(customers.id))).records.find(
          (r) => r.id === automatic.id,
        )?.values[flag.id],
        '已处理',
      )
      // Reopening pools uses the persisted encrypted connection and database identity.
      await closeProjectDatabases()
      assert.equal((await (await request(`/tables/${customers.id}/records`)).json()).total, 3)
      const scoped = await (await request(`/projects/${p.id}/context`)).json()
      assert.equal(scoped.tables.length, 2)
      assert.equal(JSON.stringify(scoped).includes(connection.password), false)
      const mcp = await mcpClient(`/tables/${customers.id}`)
      try {
        const rows = await mcp.callTool({ name: 'records_list', arguments: {} })
        assert.ok(!rows.isError, JSON.stringify(rows))
        assert.equal(
          ((rows.structuredContent as Record<string, unknown>).result as { total: number }).total,
          3,
        )
      } finally {
        await mcp.close()
      }
      assert.equal((await listProjects()).find((x) => x.id === p.id)?.recordCount, 4)
      const safe = await (await request(`/projects/${p.id}/database`)).json()
      assert.equal(safe.database, connection.database)
      assert.equal(JSON.stringify(safe).includes(connection.password), false)
      await assert.rejects(
        createManagedProject({ name: '重复绑定', database: { mode: 'independent', connection } }),
        /已有项目|已经绑定/,
      )
      await pool.query('UPDATE iw_data.project_databases SET ready=false WHERE project_id=$1', [
        p.id,
      ])
      await closeProjectDatabases()
      await withProject(p.id, () => store.getTables(p.id))
      assert.equal(
        (
          await pool.query('SELECT ready FROM iw_data.project_databases WHERE project_id=$1', [
            p.id,
          ])
        ).rows[0].ready,
        true,
      )
      const orderBefore = (await withProject(p.id, () => store.getTables(p.id))).map((t) => t.id)
      const reordered = await request(
        `/projects/${p.id}/tables/order`,
        { previousIds: orderBefore, ids: [...orderBefore].reverse() },
        'PATCH',
      )
      assert.equal(reordered.status, 200)
      const currentSchema = await (await request(`/tables/${customers.id}/records`)).json()
      const moved = await request(
        `/tables/${customers.id}/fields/order`,
        {
          version: currentSchema.table.version,
          ids: currentSchema.fields.map((f: FieldDef) => f.id).reverse(),
        },
        'PATCH',
      )
      assert.equal(moved.status, 200)
      assert.equal(
        (await request(`/tables/${customers.id}`, { icon: 'chart' }, 'PATCH')).status,
        200,
      )
      assert.equal(
        (
          await request(
            `/projects/${p.id}`,
            { name: p.name, description: '', color: 'neutral', icon: 'rocket' },
            'PATCH',
          )
        ).status,
        200,
      )
      await closeProjectDatabases()
      assert.deepEqual(
        (await withProject(p.id, () => store.getTables(p.id))).map((t) => t.id),
        [...orderBefore].reverse(),
      )
      const persisted = await (
        await request(`/tables/${customers.id}/records?q=${encodeURIComponent('独立客户')}`)
      ).json()
      assert.equal(persisted.table.icon, 'chart')
      assert.equal(persisted.total, 1)
      assert.equal(persisted.fields.at(-1).isPrimary, true)
      const queryContext = await (await request(`/tables/${customers.id}/query-context`)).json()
      const selection = {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              fieldId: persisted.fields.find((f: FieldDef) => f.isPrimary).id,
              operator: 'startsWith',
              value: '独立客户',
            },
          ],
        },
      }
      const filtered = await post(`/tables/${customers.id}/query`, { selection })
      assert.equal(filtered.total, 1)
      const savedView = await post(`/tables/${customers.id}/views`, {
        name: '独立数据库筛选',
        version: queryContext.version,
        query: selection,
      })
      await closeProjectDatabases()
      const viewRows = await (
        await request(`/tables/${customers.id}/records?viewId=${savedView.view.id}&dynamic=defer`)
      ).json()
      assert.equal(viewRows.total, 1)
      assert.deepEqual(
        viewRows.records.map((r: { id: string }) => r.id),
        filtered.records.map((r: { id: string }) => r.id),
      )
      assert.equal((await listProjects()).find((x) => x.id === p.id)?.icon, 'rocket')
      assert.equal(
        (
          await pool.query(
            'SELECT project_snapshot FROM iw_data.project_databases WHERE project_id=$1',
            [p.id],
          )
        ).rows[0].project_snapshot.icon,
        'rocket',
      )
      // Refuse a changed database identity while keeping the project visible and local data usable.
      await pool.query('UPDATE iw_data.project_databases SET database_id=$2 WHERE project_id=$1', [
        p.id,
        randomUUID(),
      ])
      await closeProjectDatabases()
      try {
        assert.equal(
          (await listProjects()).find((x) => x.id === p.id)?.storage?.status,
          'unavailable',
        )
        assert.equal((await request(`/tables/${local.id}/records`)).status, 200)
        const unavailable = await request(`/projects/${p.id}/database/test`, {})
        assert.equal(unavailable.status, 400)
        assert.match((await unavailable.json()).error, /身份/)
      } finally {
        await pool.query(
          'UPDATE iw_data.project_databases SET database_id=$2 WHERE project_id=$1',
          [p.id, binding.database_id],
        )
        await closeProjectDatabases()
      }
    } finally {
      if (projectId) await deleteManagedProject(projectId)
      await closeProjectDatabases()
      await remote.end()
    }
  },
)

test('API fields fetch over HTTP, deduplicate requests, save snapshots and retain them on failure', async () => {
  const { createServer } = await import('node:http')
  const { resolveDynamicValues } = await import('../src/server/providers')
  const { clearApiCache } = await import('../src/server/api-fetch')
  let hits = 0,
    fail = false,
    lastSymbol = '',
    gate: (() => void) | undefined,
    release: (() => void) | undefined
  const server = createServer(async (req, res) => {
    hits++
    const url = new URL(req.url!, 'http://localhost')
    lastSymbol = url.searchParams.get('symbol') ?? ''
    assert.equal(req.headers.authorization, 'Bearer fixture-secret')
    if (gate) {
      const started = gate
      gate = undefined
      await new Promise<void>((r) => {
        release = r
        started()
      })
    }
    res.setHeader('Content-Type', 'application/json')
    if (fail) {
      res.statusCode = 503
      res.end('{"error":"unavailable"}')
      return
    }
    res.end(
      JSON.stringify({
        price: lastSymbol === 'NEW' ? '77.5' : '123.45',
        changePercent: '-1.25',
        rate: 0.85441,
        observedAt: '2026-09-10T10:00:00Z',
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const oldOrigins = process.env.DATA_API_ALLOWED_ORIGINS,
    oldCredentials = process.env.DATA_API_CREDENTIALS
  process.env.DATA_API_ALLOWED_ORIGINS = origin
  process.env.DATA_API_CREDENTIALS = JSON.stringify({
    fixture: { origin, header: 'Authorization', value: 'Bearer fixture-secret' },
  })
  try {
    const t = await table(),
      code = await title(t.id)
    const source = {
      provider: 'json-api',
      inputFieldId: code.id,
      url: `${origin}/quote?symbol={{value}}`,
      valuePath: '/price',
      observedAtPath: '/observedAt',
      credential: 'fixture',
      ttlSeconds: 30,
      storage: 'snapshot',
    }
    const saved = await field(t.id, { name: '股价保存', type: 'currency', source })
    const live = await field(t.id, {
      name: '涨跌幅读取',
      type: 'number',
      source: { ...source, valuePath: '/changePercent', storage: 'live' },
    })
    const id = await store.saveRecord(t.id, { values: { [code.id]: 'A&B?C' } })
    const mcp = await mcpClient(`/tables/${t.id}`)
    let first: TableData
    try {
      const storedOnly = await mcp.callTool({ name: 'records_list', arguments: {} })
      assert.ok(!storedOnly.isError)
      assert.equal(hits, 0, 'Read-only MCP calls must never contact an external API')
      assert.equal((await record(t.id, id)).version, 1)
      const refreshed = await mcp.callTool({ name: 'records_refresh', arguments: {} })
      assert.ok(!refreshed.isError, JSON.stringify(refreshed))
      first = (refreshed.structuredContent as { result: TableData }).result
    } finally {
      await mcp.close()
    }
    assert.equal(hits, 1, 'Two API fields on one row must share one HTTP request')
    assert.equal(lastSymbol, 'A&B?C', 'Row parameters must be encoded, not injected into the query')
    assert.equal(first.records[0].values[saved.id], '123.45')
    assert.equal(first.records[0].values[live.id], '-1.25')
    assert.equal(first.records[0].dynamic?.[saved.id].observedAt, '2026-09-10T10:00:00.000Z')
    const stored = await record(t.id, id)
    assert.equal(stored.values[saved.id], '123.45')
    assert.equal(stored.values[live.id], null)
    assert.equal(stored.dynamic?.[saved.id].status, 'fresh')
    assert.equal(stored.dynamic?.[live.id], undefined)
    assert.equal(stored.version, 2)
    const history = await pool.query(
      "SELECT details FROM iw_data.changes WHERE record_id=$1 AND operation='field.snapshot'",
      [id],
    )
    assert.equal(history.rowCount, 1)
    assert.equal(history.rows[0].details.fields[0].value, '123.45')
    await resolveDynamicValues(await store.getData(t.id))
    assert.equal(hits, 1)
    assert.equal(
      (await record(t.id, id)).version,
      2,
      'Unchanged refresh must not invalidate manual edits',
    )
    const response = await app.request(`http://localhost/api/tables/${t.id}/records`)
    assert.equal(response.status, 200)
    assert.equal(JSON.stringify(await response.json()).includes('fixture-secret'), false)
    const rate = await field(t.id, {
      name: '汇率',
      type: 'number',
      source: { ...source, valuePath: '/rate', decimalPlaces: 4 },
    })
    const rounded = await resolveDynamicValues(await store.getData(t.id))
    assert.equal(rounded.records[0].values[rate.id], '0.8544')
    assert.equal((await record(t.id, id)).values[rate.id], '0.8544')
    assert.equal(hits, 1, 'An additional output field reuses the configured request')
    await assert.rejects(
      store.saveRecord(t.id, { version: 2, values: { [saved.id]: '999' } }, id),
      /只读/,
    )
    await changeExtension('automation', 'install')
    try {
      await assert.rejects(
        createRule(t.id, { name: '不可写 API', fieldId: saved.id, value: '3' }),
        /普通字段/,
      )
    } finally {
      await changeExtension('automation', 'disable')
      await changeExtension('automation', 'uninstall')
    }
    await assert.rejects(changeExtension('api-fields', 'disable'), /字段/)
    const bad = await field(t.id, {
      name: '坏路径',
      type: 'number',
      source: { ...source, valuePath: '/missing', storage: 'live' },
    })
    const invalid = await resolveDynamicValues(await store.getData(t.id))
    assert.equal(invalid.records[0].dynamic?.[bad.id].status, 'unavailable')
    assert.equal(invalid.records[0].values[saved.id], '123.45')
    clearApiCache()
    fail = true
    const offline = await resolveDynamicValues(await store.getData(t.id))
    assert.equal(offline.records[0].values[saved.id], '123.45')
    assert.equal(offline.records[0].dynamic?.[saved.id].status, 'stale')
    assert.equal(offline.records[0].values[live.id], null)
    clearApiCache()
    fail = false
    const started = new Promise<void>((r) => {
      gate = r
    })
    const pending = resolveDynamicValues(await store.getData(t.id))
    await started
    await store.saveRecord(
      t.id,
      { version: (await record(t.id, id)).version, values: { [code.id]: 'NEW' } },
      id,
    )
    release!()
    const staleWrite = await pending
    assert.equal(staleWrite.records[0].dynamic?.[saved.id].status, 'unavailable')
    assert.equal(
      (await record(t.id, id)).values[saved.id],
      null,
      'Changing the input clears the old company snapshot',
    )
    assert.equal((await record(t.id, id)).dynamic?.[saved.id], undefined)
    const newer = await resolveDynamicValues(await store.getData(t.id))
    assert.equal(newer.records[0].values[saved.id], '77.5')
    await assert.rejects(
      field(t.id, {
        name: '非授权地址',
        type: 'number',
        source: { ...source, url: 'http://127.0.0.1:9/private' },
      }),
      /尚未获准/,
    )
    await assert.rejects(
      field(t.id, {
        name: '跨表参数',
        type: 'number',
        source: { ...source, inputFieldId: randomUUID() },
      }),
      /当前表/,
    )
    const fixedTable = await table()
    const fixedSource = { ...source, inputFieldId: undefined, url: `${origin}/quote` }
    const fixedField = await field(fixedTable.id, {
      name: '固定接口',
      type: 'number',
      source: fixedSource,
    })
    const fixedRow = await store.saveRecord(fixedTable.id, { values: {} })
    await store.saveRecord(fixedTable.id, { values: {} })
    const hitsBefore = hits
    const fixed = await resolveDynamicValues(await store.getData(fixedTable.id))
    assert.equal(hits, hitsBefore + 1, 'An API without variables shares one request across rows')
    assert.ok(
      fixed.records.every(
        (r) =>
          r.values[fixedField.id] === '123.45' && r.dynamic?.[fixedField.id].status === 'fresh',
      ),
    )
    assert.equal((await record(fixedTable.id, fixedRow)).values[fixedField.id], '123.45')
    await assert.rejects(
      field(fixedTable.id, {
        name: '缺少必要变量',
        type: 'number',
        source: { ...fixedSource, url: `${origin}/quote?symbol={{value}}` },
      }),
      /当前表/,
    )
  } finally {
    release?.()
    clearApiCache()
    if (oldOrigins === undefined) delete process.env.DATA_API_ALLOWED_ORIGINS
    else process.env.DATA_API_ALLOWED_ORIGINS = oldOrigins
    if (oldCredentials === undefined) delete process.env.DATA_API_CREDENTIALS
    else process.env.DATA_API_CREDENTIALS = oldCredentials
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
})

test('AI blueprints resolve API source field keys and preserve rollback on bad bindings', async () => {
  const b = exampleBlueprint()
  b.project = { name: `自动验证-API结构-${randomUUID()}`, description: '' }
  b.tables = b.tables.slice(0, 1)
  b.relations = []
  b.tables[0].fields.push({
    key: 'quote',
    name: 'API 股价',
    type: 'number',
    required: false,
    options: [],
    source: {
      provider: 'json-api',
      inputFieldId: 'symbol',
      url: 'https://www.alphavantage.co/query?symbol={{value}}',
      valuePath: '/price',
      observedAtPath: '',
      storage: 'snapshot',
      ttlSeconds: 30,
      unit: '元',
    },
  })
  b.tables[0].fields.push({
    key: 'symbol',
    name: '证券代码',
    type: 'text',
    required: false,
    options: [],
  })
  const preview = await applyBlueprint(b, true)
  assert.equal(preview.preview, true)
  const result = await applyBlueprint(b)
  projects.push(result.projectId)
  const schema = await store.getData(result.tables[0].id)
  assert.equal(
    schema.fields.find((f) => f.name === 'API 股价')?.source?.inputFieldId,
    result.tables[0].fieldIds.symbol,
  )
  const before = (await store.getTables(result.projectId)).length
  b.requestId = randomUUID()
  b.project = { id: result.projectId }
  b.tables[0].name = '失败不留表'
  b.tables[0].fields.find((f) => f.key === 'quote')!.source!.inputFieldId = 'not_found'
  await assert.rejects(applyBlueprint(b), /当前表/)
  assert.equal((await store.getTables(result.projectId)).length, before)
})

test('API configuration updates existing fields with version checks, audit and atomic invalidation', async () => {
  const t = await table(),
    code = await title(t.id)
  const f = await field(t.id, {
    name: '股价',
    type: 'currency',
    source: {
      provider: 'json-api',
      inputFieldId: code.id,
      url: 'https://www.alphavantage.co/query?symbol={{value}}',
      storage: 'snapshot',
    },
  })
  const r = await store.saveRecord(t.id, { values: { [code.id]: 'TSLA' } })
  await pool.query(
    `UPDATE iw_data.${identifier(t.id)} SET ${identifier(f.id, 'f')}=$1 WHERE _record_id=$2`,
    ['12345678901234.5678', r],
  )
  await pool.query('UPDATE iw_data.record_index SET api_state=$1 WHERE id=$2', [
    JSON.stringify({
      [f.id]: {
        status: 'fresh',
        source: 'old',
        simulated: false,
        fetchedAt: '2026-09-10T00:00:00Z',
      },
    }),
    r,
  ])
  const before = await store.getData(t.id)
  const input = store.apiFieldUpdateInput.parse({
    tableVersion: before.table.version,
    name: '股价',
    source: {
      provider: 'tencent-stock',
      inputFieldId: code.id,
      metric: 'price',
      storage: 'snapshot',
      unit: 'USD',
      ttlSeconds: 60,
    },
  })
  const response = await app.request(`http://localhost/api/tables/${t.id}/fields/${f.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  assert.equal(response.status, 200, await response.clone().text())
  const updated = await store.getData(t.id)
  assert.equal(updated.fields.length, before.fields.length)
  assert.equal(updated.records[0].id, r)
  assert.equal(updated.records[0].values[code.id], 'TSLA')
  assert.equal(updated.records[0].values[f.id], null)
  assert.equal(updated.records[0].dynamic?.[f.id], undefined)
  assert.equal(updated.records[0].version, before.records[0].version + 1)
  const history = await pool.query(
    "SELECT details FROM iw_data.changes WHERE record_id=$1 AND operation='field.source.changed'",
    [r],
  )
  assert.equal(history.rows[0].details.previousValue, '12345678901234.5678')
  await assert.rejects(store.updateApiField(t.id, f.id, input), /结构已改变/)
  await assert.rejects(
    store.updateApiField(t.id, f.id, {
      ...input,
      tableVersion: updated.table.version,
      source: { ...input.source, inputFieldId: randomUUID() },
    }),
    /当前表/,
  )
  assert.equal((await store.getData(t.id)).table.version, updated.table.version)
  await store.updateApiField(t.id, f.id, {
    ...input,
    tableVersion: updated.table.version,
    source: { ...input.source, ttlSeconds: 120 },
  })
  assert.equal(
    (await record(t.id, r)).version,
    updated.records[0].version,
    'Changing refresh cadence must not clear values or invalidate edits',
  )
})

test('presentation order and icons persist without changing record titles, links, API bindings or values', async () => {
  const p = await project(),
    a = await table(p.id),
    b = await table(p.id),
    foreign = await table()
  await store.renameTable(a.id, { description: '保留原有描述' })
  const first = await title(a.id)
  const other = await field(a.id, { name: '别名', type: 'text' })
  const apiField = await field(a.id, {
    name: '价格',
    type: 'number',
    source: { provider: 'tencent-stock', inputFieldId: other.id, storage: 'live', ttlSeconds: 60 },
  })
  const rel = await field(b.id, {
    name: '关联公司',
    type: 'relation',
    targetTableId: a.id,
    reverseName: '业务',
  })
  const row = await store.saveRecord(a.id, {
    values: { [first.id]: '真实名称', [other.id]: 'TSLA' },
  })
  const linked = await store.saveRecord(b.id, { values: { [rel.id]: [row] } })
  const before = await store.getData(a.id)
  const request = (path: string, body: unknown) =>
    app.request(`http://localhost/api${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const ids = before.fields.map((f) => f.id).reverse()
  const moved = await request(`/tables/${a.id}/fields/order`, {
    ids,
    version: before.table.version,
  })
  assert.equal(moved.status, 200, await moved.clone().text())
  const reordered = await store.getData(a.id)
  assert.deepEqual(
    reordered.fields.map((f) => f.id),
    ids,
  )
  assert.equal(reordered.fields.at(-1)?.isPrimary, true)
  assert.deepEqual(reordered.records, before.records)
  assert.deepEqual(reordered.fields.find((f) => f.id === apiField.id)?.source, apiField.source)
  assert.equal((await store.getData(a.id, 1, '真实')).total, 1)
  assert.equal((await store.getData(a.id, 1, 'TSLA')).total, 0)
  assert.equal((await store.getOptions(a.id))[0].label, '真实名称')
  assert.equal(links((await record(b.id, linked)).values[rel.id])[0].label, '真实名称')
  await changeExtension('relations', 'install')
  assert.equal((await relationGraph(a.id)).nodes.find((n) => n.id === row)?.label, '真实名称')
  assert.equal(
    (await request(`/tables/${a.id}/fields/order`, { ids, version: before.table.version })).status,
    409,
  )
  assert.equal(
    (
      await request(`/tables/${a.id}/fields/order`, {
        ids: [first.id, first.id],
        version: reordered.table.version,
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await request(`/tables/${a.id}/fields/order`, {
        ids: [...ids.slice(1), (await title(foreign.id)).id],
        version: reordered.table.version,
      })
    ).status,
    409,
  )
  const navBefore = (await store.getTables(p.id)).map((t) => t.id)
  const navAfter = [...navBefore].reverse()
  assert.equal(
    (await request(`/projects/${p.id}/tables/order`, { ids: navAfter, previousIds: navBefore }))
      .status,
    200,
  )
  assert.equal(
    (await request(`/projects/${p.id}/tables/order`, { ids: navAfter, previousIds: navBefore }))
      .status,
    409,
  )
  assert.equal(
    (
      await request(`/projects/${p.id}/tables/order`, {
        ids: [foreign.id, a.id],
        previousIds: navAfter,
      })
    ).status,
    409,
  )
  const c = await table(p.id)
  assert.deepEqual(
    (await store.getTables(p.id)).map((t) => t.id),
    [...navAfter, c.id],
  )
  const renamed = await request(`/tables/${a.id}`, {
    icon: 'chart',
    version: reordered.table.version,
  })
  assert.equal(renamed.status, 200)
  const updatedMetadata = await renamed.json()
  assert.equal(updatedMetadata.name, a.name)
  assert.equal(updatedMetadata.description, '保留原有描述')
  assert.deepEqual(store.tableUpdateInput.parse({ icon: 'chart' }), { icon: 'chart' })
  assert.equal((await request(`/tables/${a.id}`, { icon: '__proto__' })).status, 400)
  await migrate()
  assert.deepEqual(
    (await store.getTables(p.id)).map((t) => t.id),
    [...navAfter, c.id],
  )
  const reopened = await store.getData(a.id)
  assert.equal(reopened.table.icon, 'chart')
  assert.deepEqual(
    reopened.fields.map((f) => f.id),
    ids,
  )
  assert.equal(reopened.fields.at(-1)?.id, first.id)
  assert.deepEqual(reopened.records, before.records)
})

test('concurrent field reorder accepts one version and never drops or duplicates fields', async () => {
  const t = await table()
  await field(t.id, { name: '数字', type: 'number' })
  await field(t.id, { name: '备注', type: 'text' })
  const data = await store.getData(t.id),
    ids = data.fields.map((f) => f.id)
  const candidates = [
    [ids[2], ids[0], ids[1]],
    [ids[1], ids[2], ids[0]],
  ]
  const results = await Promise.allSettled(
    candidates.map((ids) => store.reorderFields(t.id, { ids, version: data.table.version })),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const winner = results.findIndex((r) => r.status === 'fulfilled')
  assert.deepEqual(
    (await store.getData(t.id)).fields.map((f) => f.id),
    candidates[winner],
  )
})
