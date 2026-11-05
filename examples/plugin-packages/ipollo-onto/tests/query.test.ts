import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, migrate, identifier, transaction } from '../src/server/db'
import * as store from '../src/server/store'
import { app } from '../src/server/app'
import { listRecords } from '../src/server/list-records'
import { recordQueryInput, type FilterCondition } from '../src/core/query'
import type { FieldDef, TableDef, TableData } from '../src/core/contracts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const projects: string[] = []
let table: TableDef, target: TableDef, outside: TableDef
let name: FieldDef,
  amount: FieldDef,
  enabled: FieldDef,
  date: FieldDef,
  timestamp: FieldDef,
  tags: FieldDef,
  relation: FieldDef,
  external: FieldDef,
  city: FieldDef,
  snapshot: FieldDef,
  live: FieldDef
const rows: string[] = []
const post = (path: string, body: unknown) =>
  app.request(`http://localhost/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const query = (...conditions: FilterCondition[]) =>
  recordQueryInput.parse({ filter: { conjunction: 'and', conditions } })
async function field(t: string, name: string, type: string, extra = {}) {
  return (await store.createField(t, store.fieldInput.parse({ name, type, ...extra })))!
}
before(async () => {
  await migrate()
  for (let i = 0; i < 2; i++)
    projects.push(
      (await store.createProject(store.projectInput.parse({ name: `筛选测试-${randomUUID()}` })))
        .id,
    )
  table = await store.createTable(projects[0], store.tableInput.parse({ name: '项目' }))
  target = await store.createTable(projects[0], store.tableInput.parse({ name: '客户' }))
  outside = await store.createTable(projects[1], store.tableInput.parse({ name: '范围外' }))
  name = (await store.getTableSchema(table.id)).fields[0]
  amount = await field(table.id, '金额', 'number')
  enabled = await field(table.id, '启用', 'boolean')
  date = await field(table.id, '日期', 'date')
  timestamp = await field(table.id, '时间', 'datetime')
  tags = await field(table.id, '标签', 'tags')
  city = await field(target.id, '城市', 'text')
  relation = await field(table.id, '客户', 'relation', {
    targetTableId: target.id,
    reverseName: '项目',
    multiple: true,
  })
  external = await field(table.id, '外部客户', 'relation', {
    targetTableId: outside.id,
    reverseName: '项目',
    multiple: true,
  })
  const source = {
    provider: 'tencent-stock',
    metric: 'price',
    inputFieldId: name.id,
    ttlSeconds: 60,
    storage: 'snapshot',
  }
  snapshot = await field(table.id, '保存价格', 'number', { source })
  live = await field(table.id, '实时价格', 'number', { source: { ...source, storage: 'live' } })
  const beijing = await store.saveRecord(target.id, { values: { [city.id]: '北京' } })
  const shanghai = await store.saveRecord(target.id, { values: { [city.id]: '上海' } })
  const other = await store.saveRecord(outside.id, { values: {} })
  await transaction(async (db) => {
    for (let i = 0; i < 64; i++)
      rows.push(
        await store.saveRecord(
          table.id,
          {
            values: {
              [name.id]:
                i === 0 ? "100%_公司'; DROP TABLE x;--" : `公司-${String(i).padStart(3, '0')}`,
              [amount.id]: String(i),
              [enabled.id]: i % 2 === 0,
              ...(i === 0
                ? {
                    [date.id]: '2026-09-11',
                    [timestamp.id]: '2026-09-11T09:00:00+08:00',
                    [tags.id]: ['a', 'b'],
                    [relation.id]: [beijing, shanghai],
                    [external.id]: [other],
                  }
                : {}),
            },
          },
          undefined,
          db,
        ),
      )
    rows.push(await store.saveRecord(table.id, { values: {} }, undefined, db))
    // A stored-value fixture, never an external API demo or a live quote.
    await db.query(
      `UPDATE iw_data.${identifier(table.id)} SET ${identifier(snapshot.id, 'f')}=123.45 WHERE _record_id=$1`,
      [rows[0]],
    )
    await db.query('UPDATE iw_data.record_index SET api_state=$2::jsonb WHERE id=$1', [
      rows[0],
      JSON.stringify({
        [snapshot.id]: {
          status: 'stale',
          fetchedAt: '2026-09-10T00:00:00.000Z',
          source: 'test fixture',
        },
      }),
    ])
  })
})
after(async () => {
  try {
    for (const id of projects.reverse()) await store.deleteProject(id)
  } finally {
    await pool.end()
  }
})

test('conditions and stable numeric sorting apply before pagination, count and projection agree', async () => {
  const selection = {
    ...query({ fieldId: amount.id, operator: 'gte', value: '4' }),
    sort: [{ fieldId: amount.id, direction: 'desc' as const }],
  }
  const first = await listRecords(table.id, { selection })
  const second = await listRecords(table.id, { selection, page: 2 })
  assert.equal(first.total, 60)
  assert.equal(first.records.length, 50)
  assert.equal(second.records.length, 10)
  assert.equal(first.records[0].values[amount.id], '63')
  assert.equal(second.records.at(-1)!.values[amount.id], '4')
  assert.equal(new Set([...first.records, ...second.records].map((r) => r.id)).size, 60)
  assert.deepEqual(first.appliedQuery, selection)
  const nested = recordQueryInput.parse({
    filter: {
      conjunction: 'and',
      conditions: [
        { fieldId: enabled.id, operator: 'eq', value: true },
        {
          conjunction: 'or',
          conditions: [
            { fieldId: amount.id, operator: 'gte', value: 60 },
            { fieldId: amount.id, operator: 'eq', value: 0 },
          ],
        },
      ],
    },
  })
  assert.equal((await listRecords(table.id, { selection: nested })).total, 3)
  const sorted = await listRecords(table.id, {
    selection: { sort: [{ fieldId: amount.id, direction: 'desc' }], search: '' },
    page: 2,
  })
  assert.equal(sorted.records.at(-1)!.id, rows[64], 'Nulls sort last, regardless of direction')
})

test('typed null, date, timezone, list and literal wildcard semantics are consistent', async () => {
  const total = async (...c: FilterCondition[]) =>
    (await listRecords(table.id, { selection: query(...c) })).total
  assert.equal(await total({ fieldId: amount.id, operator: 'isEmpty' }), 1)
  assert.equal(await total({ fieldId: enabled.id, operator: 'eq', value: false }), 32)
  assert.equal(
    await total({ fieldId: amount.id, operator: 'neq', value: 1 }),
    63,
    'Null is not silently included in negative comparisons',
  )
  assert.equal(await total({ fieldId: date.id, operator: 'eq', value: '2026-09-11' }), 1)
  assert.equal(
    await total({ fieldId: timestamp.id, operator: 'eq', value: '2026-09-11T01:00:00Z' }),
    1,
  )
  assert.equal(await total({ fieldId: tags.id, operator: 'hasAll', value: ['a', 'b'] }), 1)
  assert.equal(await total({ fieldId: tags.id, operator: 'isEmpty' }), 64)
  assert.equal(await total({ fieldId: name.id, operator: 'contains', value: '%_' }), 1)
  assert.equal(
    await total({ fieldId: name.id, operator: 'contains', value: "'; DROP TABLE x;--" }),
    1,
  )
  assert.equal(
    await total({ fieldId: name.id, operator: 'in', value: ['公司-001', '公司-063'] }),
    2,
  )
})

test('one-hop relations use EXISTS without duplicates and enforce project/table scope', async () => {
  const selection = query({
    fieldId: relation.id,
    relatedFieldId: city.id,
    operator: 'in',
    value: ['北京', '上海'],
  })
  assert.equal((await listRecords(table.id, { selection })).total, 1)
  const projectRead = await post(`/projects/${projects[0]}/operations/records_list`, {
    tableId: table.id,
    selection,
  })
  assert.equal(projectRead.status, 200, await projectRead.clone().text())
  assert.equal((await projectRead.json()).total, 1)
  assert.equal(
    (await post(`/tables/${table.id}/operations/records_list`, { selection })).status,
    400,
  )
  const forbidden = query({ fieldId: external.id, operator: 'isNotEmpty' })
  assert.equal(
    (
      await post(`/projects/${projects[0]}/operations/records_list`, {
        tableId: table.id,
        selection: forbidden,
      })
    ).status,
    400,
  )
  const context = await store.getQueryContext(table.id, new Set([table.id, target.id]))
  assert.ok(!JSON.stringify(context).includes(outside.id))
  const values = (await listRecords(table.id, { selection })).records[0].values[
    relation.id
  ] as Array<{ id: string }>
  assert.equal(
    (
      await listRecords(table.id, {
        selection: query({
          fieldId: relation.id,
          operator: 'hasAll',
          value: values.map((v) => v.id),
        }),
      })
    ).total,
    1,
  )
  assert.equal(
    (
      await listRecords(table.id, {
        selection: query({ fieldId: relation.id, operator: 'isEmpty' }),
      })
    ).total,
    64,
  )
})

test('snapshots filter committed values with provenance; live fields fail explicitly and never fetch', async () => {
  const selection = query({ fieldId: snapshot.id, operator: 'gt', value: 100 })
  const data = await listRecords(table.id, { selection }, 'resolve')
  assert.equal(data.total, 1)
  assert.deepEqual(data.queryInfo?.snapshotFields, [snapshot.id])
  assert.equal(data.records[0].dynamic?.[snapshot.id].status, 'stale')
  assert.equal(data.records[0].dynamic?.[snapshot.id].fetchedAt, '2026-09-10T00:00:00.000Z')
  await assert.rejects(
    listRecords(table.id, { selection: query({ fieldId: live.id, operator: 'gt', value: 1 }) }),
    /动态 API/,
  )
  await assert.rejects(
    listRecords(table.id, { selection: { sort: [{ fieldId: live.id, direction: 'asc' }] } }),
    /动态 API/,
  )
})

test('invalid shapes, values and fields are rejected as client errors without broadening the query', async () => {
  const bad: unknown[] = [
    { filter: { conjunction: 'and', conditions: [] } },
    query({ fieldId: amount.id, operator: 'eq', value: true }),
    query({ fieldId: amount.id, operator: 'contains', value: '1' }),
    query({ fieldId: date.id, operator: 'eq', value: '2026-02-30' }),
    query({ fieldId: randomUUID(), operator: 'isNotEmpty' }),
    query({ fieldId: name.id, relatedFieldId: city.id, operator: 'eq', value: '北京' }),
    { sort: [{ fieldId: name.id, direction: 'DROP TABLE' }] },
    {
      filter: {
        conjunction: 'or',
        conditions: Array.from({ length: 41 }, () => ({
          fieldId: name.id,
          operator: 'isNotEmpty',
        })),
      },
    },
  ]
  for (const selection of bad)
    assert.equal(
      (await post(`/tables/${table.id}/query`, { selection })).status,
      400,
      JSON.stringify(selection),
    )
  assert.equal((await listRecords(table.id, {})).total, 65)
})

test('saved views persist, re-query current records and reject concurrent overwrites', async () => {
  const context = await store.getQueryContext(table.id)
  const selection = query({ fieldId: amount.id, operator: 'gt', value: 60 })
  const saved = await store.saveQueryView(table.id, {
    name: '高金额',
    query: selection,
    version: context.version,
  })
  assert.equal((await store.getQueryContext(table.id)).views[0].name, '高金额')
  assert.equal((await listRecords(table.id, { viewId: saved.view.id })).total, 3)
  await store.saveRecord(table.id, { values: { [amount.id]: '80' }, version: 1 }, rows[1])
  assert.equal(
    (await listRecords(table.id, { viewId: saved.view.id })).total,
    4,
    'View stores a query, not a copy of the rows',
  )
  const attempts = await Promise.allSettled(
    ['A', 'B'].map((name) =>
      store.saveQueryView(table.id, { name, query: selection, version: saved.version }),
    ),
  )
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(attempts.some((r) => r.status === 'rejected' && r.reason.status === 409))
  const fresh = await store.getQueryContext(table.id)
  await assert.rejects(listRecords(table.id, { viewId: saved.view.id, selection }), /只能选择一种/)
  await store.deleteQueryView(table.id, saved.view.id, fresh.version)
  await assert.rejects(listRecords(table.id, { viewId: saved.view.id }), /视图不存在/)
})

test('official MCP and REST execute the same visual query and expose typed capabilities', async () => {
  const selection = {
    ...query({ fieldId: amount.id, operator: 'gt', value: 60 }),
    sort: [{ fieldId: amount.id, direction: 'desc' as const }],
  }
  const rest = (await (await post(`/tables/${table.id}/query`, { selection })).json()) as TableData
  const client = new Client({ name: 'query-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost/api/tables/${table.id}/mcp`),
    { fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))) },
  )
  try {
    await client.connect(transport)
    const tools = (await client.listTools()).tools
    assert.ok(tools.find((t) => t.name === 'records_list')?.inputSchema.properties?.selection)
    const response = await client.callTool({ name: 'records_list', arguments: { selection } })
    assert.ok(!response.isError, JSON.stringify(response))
    const data = (response.structuredContent as { result: TableData }).result
    assert.deepEqual(
      data.records.map((r) => r.id),
      rest.records.map((r) => r.id),
    )
    assert.deepEqual(data.appliedQuery, rest.appliedQuery)
    const context = await client.callTool({ name: 'query_context', arguments: {} })
    assert.ok(!context.isError, JSON.stringify(context))
    assert.ok(
      !JSON.stringify(context).includes(city.id),
      'Single-table scope cannot expose linked fields',
    )
  } finally {
    await client.close()
  }
})
