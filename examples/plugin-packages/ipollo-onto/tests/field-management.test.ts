import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { app } from '../src/server/app'
import { pool, migrate, identifier, transaction, lockFieldReferences } from '../src/server/db'
import * as store from '../src/server/store'
import { updateField, previewFieldDelete, deleteField } from '../src/server/field-management'
import { createDocument, updateDocument } from '../src/server/documents'
import { createRule, changeRule } from '../src/server/automation'
import { executeCommand } from '../src/server/commands'
import { integration } from '../src/server/integration'
import { referencesField } from '../src/core/field-management'
import { changeExtension, getExtensions } from '../src/server/extensions'
import { emptyQuery } from '../src/core/query'

const projects: string[] = []
let automationState: { installedVersion?: string | null; enabled: boolean }
before(async () => {
  await migrate()
  automationState = (await getExtensions()).find((extension) => extension.id === 'automation')!
  await changeExtension('automation', 'install')
})
after(async () => {
  for (const id of projects) await store.deleteProject(id)
  if (!automationState.installedVersion) await changeExtension('automation', 'uninstall')
  else if (!automationState.enabled) await changeExtension('automation', 'disable')
  await pool.end()
})
async function table() {
  const project = await store.createProject(
    store.projectInput.parse({ name: `Fields ${randomUUID()}` }),
  )
  projects.push(project.id)
  const table = await store.createTable(project.id, store.tableInput.parse({ name: '用户' }))
  return table
}
async function field(tableId: string, name: string, type = 'text', extra = {}) {
  return (await store.createField(tableId, store.fieldInput.parse({ name, type, ...extra })))!
}
async function version(tableId: string) {
  return (await store.getTableSchema(tableId)).version
}
async function remove(tableId: string, fieldId: string) {
  const preview = await previewFieldDelete(tableId, fieldId)
  return deleteField(tableId, fieldId, {
    tableVersion: preview.tableVersion,
    relatedTableVersion: preview.relatedTableVersion,
  })
}

test('ordinary required/contact fields are editable and deletable; only primary identity stays protected', async () => {
  const t = await table(),
    email = await field(t.id, '邮箱', 'email', { required: true }),
    phone = await field(t.id, '手机号', 'phone')
  const primary = (await store.getTableSchema(t.id)).fields.find((f) => f.isPrimary)!
  const recordId = await store.saveRecord(t.id, {
    values: { [primary.id]: 'Ada', [email.id]: 'ada@example.com', [phone.id]: '13800138000' },
  })
  await updateField(t.id, email.id, {
    tableVersion: await version(t.id),
    name: '联系邮箱',
    required: false,
  })
  await updateField(t.id, primary.id, { tableVersion: await version(t.id), name: '客户名称' })
  const stale = await version(t.id)
  await updateField(t.id, phone.id, { tableVersion: stale, name: '手机' })
  await assert.rejects(deleteField(t.id, email.id, { tableVersion: stale }), /结构已改变/)
  assert.equal((await previewFieldDelete(t.id, primary.id)).blockers[0].kind, 'primary')
  await assert.rejects(remove(t.id, primary.id), /不能删除/)
  await assert.rejects(
    updateField(t.id, primary.id, { tableVersion: await version(t.id), type: 'longtext' }),
    /保留文本/,
  )
  assert.equal((await previewFieldDelete(t.id, email.id)).valueCount, 1)
  await remove(t.id, email.id)
  const result = await store.getData(t.id)
  assert.equal(result.records[0].id, recordId)
  assert.equal(result.records[0].values[phone.id], '13800138000')
  assert.equal(result.records[0].values[primary.id], 'Ada')
  assert.ok(!result.fields.some((f) => f.id === email.id))
  // Required is a record-entry constraint, not a schema lock.
  const t2 = await table(),
    required = await field(t2.id, '必填说明', 'text', { required: true })
  await remove(t2.id, required.id)
})

test('select editing preserves values, refuses incompatible conversion and required constraints atomically', async () => {
  const t = await table(),
    kind = await field(t.id, '类型', 'select', { options: ['课程', '商品'] })
  await store.saveRecord(t.id, { values: { [kind.id]: '课程' } })
  await updateField(t.id, kind.id, {
    tableVersion: await version(t.id),
    options: ['课程', '服务'],
    name: '分类',
  })
  const before = await version(t.id)
  await assert.rejects(
    updateField(t.id, kind.id, { tableVersion: before, options: ['服务'] }),
    /已有记录不符合/,
  )
  assert.equal(await version(t.id), before)
  await assert.rejects(
    updateField(t.id, kind.id, { tableVersion: before, type: 'number' }),
    /已有数据/,
  )
  await updateField(t.id, kind.id, { tableVersion: before, type: 'text', options: [] })
  assert.equal((await store.getData(t.id)).records[0].values[kind.id], '课程')
  const optional = await field(t.id, '备注')
  await assert.rejects(
    updateField(t.id, optional.id, { tableVersion: await version(t.id), required: true }),
    /空值/,
  )
  await updateField(t.id, optional.id, { tableVersion: await version(t.id), type: 'number' })
  assert.equal(
    (await store.getTableSchema(t.id)).fields.find((f) => f.id === optional.id)!.type,
    'number',
  )
  await assert.rejects(
    updateField(t.id, optional.id, {
      tableVersion: await version(t.id),
      type: 'date',
      required: true,
    }),
    /空值/,
  )
  assert.equal(
    (await store.getTableSchema(t.id)).fields.find((f) => f.id === optional.id)!.type,
    'number',
  )
})

test('API input references block removal; deleting an API field clears its snapshots and layout entries', async () => {
  const t = await table(),
    code = await field(t.id, '股票代码')
  const quote = await field(t.id, '股价', 'number', {
    source: {
      provider: 'tencent-stock',
      inputFieldId: code.id,
      metric: 'price',
      storage: 'snapshot',
      ttlSeconds: 30,
      unit: 'USD',
    },
  })
  const rid = await store.saveRecord(t.id, { values: { [code.id]: 'TSLA' } })
  assert.ok((await previewFieldDelete(t.id, code.id)).blockers.some((b) => b.kind === 'api'))
  await assert.rejects(remove(t.id, code.id), /仍被/)
  await updateField(t.id, quote.id, { tableVersion: await version(t.id), name: '最新股价' })
  await pool.query('UPDATE iw_data.record_index SET api_state=$2 WHERE id=$1', [
    rid,
    JSON.stringify({ [quote.id]: { status: 'fresh' } }),
  ])
  await store.saveDetailLayout(t.id, {
    version: await version(t.id),
    fieldOrder: (await store.getTableSchema(t.id)).fields.map((f) => f.id),
  })
  await remove(t.id, quote.id)
  assert.deepEqual(
    (await pool.query('SELECT api_state FROM iw_data.record_index WHERE id=$1', [rid])).rows[0]
      .api_state,
    {},
  )
  assert.ok(!(await store.getTableSchema(t.id)).detailLayout?.fieldOrder.includes(quote.id))
  await remove(t.id, code.id)
})

test('relation deletion checks both table versions and scope, clears paired fields/links/indexes, keeps records', async () => {
  const t = await table(),
    target = await store.createTable(t.projectId, store.tableInput.parse({ name: '订单' }))
  const rel = await field(t.id, '订单', 'relation', {
    targetTableId: target.id,
    reverseName: '用户',
    multiple: false,
    inverseMultiple: false,
  })
  const targetId = await store.saveRecord(target.id, { values: {} })
  const sourceId = await store.saveRecord(t.id, { values: { [rel.id]: [targetId] } })
  const preview = await previewFieldDelete(t.id, rel.id)
  assert.equal(preview.fields.length, 2)
  assert.equal(preview.valueCount, 1)
  await assert.rejects(previewFieldDelete(t.id, rel.id, new Set([t.id])), /接入范围/)
  await assert.rejects(
    deleteField(t.id, rel.id, { tableVersion: preview.tableVersion }),
    /结构已改变/,
  )
  const reverse = (await store.getTableSchema(target.id)).fields.find(
    (f) => f.relationId === rel.relationId,
  )!
  await updateField(target.id, reverse.id, { tableVersion: await version(target.id), name: '会员' })
  await assert.rejects(
    deleteField(t.id, rel.id, {
      tableVersion: preview.tableVersion,
      relatedTableVersion: preview.relatedTableVersion,
    }),
    /结构已改变/,
  )
  await remove(t.id, rel.id)
  assert.equal((await store.getData(t.id)).records[0].id, sourceId)
  assert.equal((await store.getData(target.id)).records[0].id, targetId)
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM iw_data.links WHERE relation_id=$1', [
        rel.relationId,
      ])
    ).rows[0].n,
    0,
  )
  for (const index of [rel.relationId!, rel.id])
    assert.equal(
      (await pool.query(pool.dialect === 'sqlite' ? "SELECT (SELECT name FROM sqlite_master WHERE name=replace(replace($1,'iw_data.',''),'\"','')) AS idx" : 'SELECT to_regclass($1) AS idx', [`iw_data.${identifier(index, 'idx')}`]))
        .rows[0].idx,
      null,
    )
  assert.ok(!(await store.getTableSchema(target.id)).fields.some((f) => f.id === reverse.id))
  const self = await field(t.id, '上级', 'relation', { targetTableId: t.id, reverseName: '下级' })
  const v = await version(t.id)
  await remove(t.id, self.id)
  assert.equal(await version(t.id), v + 1)
})

test('saved view, related-field filters, embedded document and automation references are checked before deletion', async () => {
  const t = await table(),
    status = await field(t.id, '状态', 'select', { options: ['正常', '停用'] })
  const rid = await store.saveRecord(t.id, { values: {} })
  const selection = {
    ...emptyQuery(),
    filter: {
      conjunction: 'and' as const,
      conditions: [{ fieldId: status.id, operator: 'eq' as const, value: '正常' }],
    },
  }
  const view = await store.saveQueryView(t.id, {
    version: await version(t.id),
    name: '正常用户',
    layout: 'grid',
    query: selection,
  })
  assert.ok((await previewFieldDelete(t.id, status.id)).blockers.some((b) => b.kind === 'view'))
  await assert.rejects(remove(t.id, status.id), /仍被/)
  await store.deleteQueryView(t.id, view.view.id, await version(t.id))
  const scope = { tableId: t.id, recordId: rid }
  const doc = await createDocument(scope, {
    title: '用户报告',
    content: { type: 'doc', content: [{ type: 'dataTable', attrs: { tableId: t.id, selection } }] },
  })
  assert.ok((await previewFieldDelete(t.id, status.id)).blockers.some((b) => b.kind === 'document'))
  await assert.rejects(remove(t.id, status.id), /仍被/)
  await updateDocument(scope, doc.id, {
    version: doc.version,
    content: { type: 'doc', content: [] },
  })
  const rule = await createRule(t.id, { name: '初始状态', fieldId: status.id, value: '正常' })
  assert.ok(
    (await previewFieldDelete(t.id, status.id)).blockers.some((b) => b.kind === 'automation'),
  )
  await assert.rejects(remove(t.id, status.id), /仍被/)
  await changeRule(t.id, rule.id, false)
  const target = await store.createTable(t.projectId, store.tableInput.parse({ name: '联系人' }))
  const rel = await field(target.id, '用户', 'relation', {
    targetTableId: t.id,
    reverseName: '联系人',
  })
  const relatedQuery = {
    ...emptyQuery(),
    filter: {
      conjunction: 'and',
      conditions: [{ fieldId: rel.id, relatedFieldId: status.id, operator: 'eq', value: '正常' }],
    },
  }
  const linkedView = await store.saveQueryView(target.id, {
    version: await version(target.id),
    name: '正常联系人',
    layout: 'grid',
    query: relatedQuery,
  })
  await assert.rejects(remove(t.id, status.id), /仍被/)
  await store.deleteQueryView(target.id, linkedView.view.id, await version(target.id))
  await remove(t.id, status.id)
  assert.equal(
    (await pool.query('SELECT id FROM iw_data.automation_rules WHERE id=$1', [rule.id])).rowCount,
    0,
  )
  await assert.rejects(
    createDocument(scope, {
      title: '旧引用',
      content: {
        type: 'doc',
        content: [{ type: 'dataTable', attrs: { tableId: t.id, selection } }],
      },
    }),
    /字段/,
  )
  assert.ok(referencesField(relatedQuery, new Set([status.id])))
  assert.ok(!referencesField({ text: status.id, value: status.id }, new Set([status.id])))
})

test('schema reference lock prevents new document references racing with field deletion', async () => {
  const t = await table(),
    f = await field(t.id, '说明'),
    rid = await store.saveRecord(t.id, { values: {} })
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((r) => {
      entered = r
    }),
    finish = new Promise<void>((r) => {
      release = r
    })
  const preview = await previewFieldDelete(t.id, f.id)
  const holder = transaction(async (db) => {
    await lockFieldReferences(db)
    entered()
    await finish
  })
  await ready
  let deleted = false
  const removing = deleteField(t.id, f.id, { tableVersion: preview.tableVersion }).then(() => {
    deleted = true
  })
  // Prove lock behavior through another connection, rather than timing a long sleep.
  if (pool.dialect === 'sqlite') await new Promise<void>(r => setImmediate(r))
  else {
    const lock = await pool.query('SELECT pg_try_advisory_lock(5710,7) AS acquired')
    assert.equal(lock.rows[0].acquired, false)
  }
  assert.equal(deleted, false)
  release()
  await holder
  await removing
  await assert.rejects(
    createDocument(
      { tableId: t.id, recordId: rid },
      {
        title: '过期结构',
        content: {
          type: 'doc',
          content: [
            {
              type: 'dataTable',
              attrs: { tableId: t.id, selection: { sort: [{ fieldId: f.id, direction: 'asc' }] } },
            },
          ],
        },
      },
    ),
    /字段/,
  )
})

test('REST, commands and actual MCP share editing/deletion with version checks', async () => {
  const t = await table(),
    f = await field(t.id, '邮箱', 'email')
  const response = await app.request(`http://localhost/api/tables/${t.id}/fields/${f.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableVersion: await version(t.id), name: '联系邮箱' }),
  })
  assert.equal(response.status, 200, await response.text())
  const info = await integration({ kind: 'table', id: t.id })
  for (const name of ['field_update', 'field_delete_preview', 'field_delete'])
    assert.ok(info.operations.some((op) => op.name === name))
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const client = new Client({ name: 'field-test', version: '1.0.0' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/api/tables/${t.id}/mcp`),
      ),
    )
    const read = await client.callTool({
      name: 'field_delete_preview',
      arguments: { fieldId: f.id },
    })
    assert.ok(!read.isError, JSON.stringify(read))
    const result = await client.callTool({
      name: 'field_update',
      arguments: { fieldId: f.id, input: { tableVersion: await version(t.id), name: '工作邮箱' } },
    })
    assert.ok(!result.isError, JSON.stringify(result))
    const preview = (await executeCommand({
      action: 'field.delete.preview',
      tableId: t.id,
      fieldId: f.id,
    })) as { tableVersion: number }
    const deleted = await client.callTool({
      name: 'field_delete',
      arguments: { fieldId: f.id, input: { tableVersion: preview.tableVersion } },
    })
    assert.ok(!deleted.isError, JSON.stringify(deleted))
    assert.ok(!(await store.getTableSchema(t.id)).fields.some((field) => field.id === f.id))
    const other = await field(t.id, '可选字段')
    const direct = await app.request(`http://localhost/api/tables/${t.id}/fields/${other.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableVersion: await version(t.id) }),
    })
    assert.equal(direct.status, 200)
  } finally {
    await client.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
