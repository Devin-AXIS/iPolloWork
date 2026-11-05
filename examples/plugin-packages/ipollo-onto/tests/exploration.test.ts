import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as store from '../src/server/store'
import { migrate, pool, transaction, identifier } from '../src/server/db'
import { exploreRelations, explorationEdgesSql, sqliteExplorationEdgesSql } from '../src/server/exploration'
import { explorationFromHash, explorationInput } from '../src/core/exploration'
import { app } from '../src/server/app'
import { changeExtension } from '../src/server/extensions'
import { integration } from '../src/server/integration'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
// @ts-expect-error Native plugin modules are plain JavaScript.
import { mergeExploration } from '../extensions/relations/layout.js'

const projects: string[] = []
let companies: string, suppliers: string, products: string, categories: string, outside: string
let a: string,
  b: string,
  isolated: string,
  supplier: string,
  product: string,
  category: string,
  secret: string
let supply: string, supplyField: string, self: string, external: string
const post = (path: string, body: unknown) =>
  app.request(`http://localhost/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
async function table(project: string, name: string) {
  return (await store.createTable(project, store.tableInput.parse({ name }))).id
}
async function row(tableId: string, title: string) {
  const f = (await store.getTableSchema(tableId)).fields.find((f) => f.isPrimary)!
  return store.saveRecord(tableId, { values: { [f.id]: title } })
}
async function relation(from: string, to: string, name: string) {
  return (await store.createField(
    from,
    store.fieldInput.parse({
      name,
      type: 'relation',
      targetTableId: to,
      reverseName: `${name}反向`,
      multiple: true,
      inverseMultiple: true,
    }),
  ))!
}
async function link(tableId: string, recordId: string, fieldId: string, targets: string[]) {
  const data = await store.getData(tableId, 1, '', recordId)
  await store.saveRecord(
    tableId,
    { version: data.records[0].version, values: { [fieldId]: targets } },
    recordId,
  )
}
before(async () => {
  await migrate()
  for (let i = 0; i < 2; i++)
    projects.push(
      (await store.createProject(store.projectInput.parse({ name: `探索验证-${randomUUID()}` })))
        .id,
    )
  companies = await table(projects[0], '公司')
  suppliers = await table(projects[0], '供应商')
  products = await table(projects[0], '产品')
  categories = await table(projects[0], '领域')
  outside = await table(projects[1], '范围外')
  a = await row(companies, 'Alpha')
  b = await row(companies, 'Beta')
  isolated = await row(companies, 'Isolated')
  supplier = await row(suppliers, 'Shared')
  product = await row(products, 'Component')
  category = await row(categories, 'Industry')
  secret = await row(outside, 'Alpha private')
  const r = await relation(companies, suppliers, '供应商')
  supply = r.relationId!
  supplyField = r.id
  const p = await relation(suppliers, products, '提供产品'),
    c = await relation(products, categories, '所属领域')
  const loop = await relation(companies, companies, '同公司')
  self = loop.relationId!
  const cycle = await relation(categories, companies, '成员')
  const hidden = await relation(companies, outside, '外部')
  external = hidden.relationId!
  await link(companies, a, r.id, [supplier])
  await link(companies, b, r.id, [supplier])
  await link(suppliers, supplier, p.id, [product])
  await link(products, product, c.id, [category])
  await link(companies, a, loop.id, [a])
  await link(categories, category, cycle.id, [a])
  await link(companies, a, hidden.id, [secret])
})
after(async () => {
  try {
    for (const id of projects.reverse()) await store.deleteProject(id)
  } finally {
    await pool.end()
  }
})

test('bounded traversal follows direction and fields, deduplicates loops, and excludes other projects', async () => {
  const one = await exploreRelations(companies, { recordIds: [a], direction: 'outgoing' })
  assert.deepEqual(new Set(one.nodes.map((n) => n.id)), new Set([a, supplier]))
  assert.equal(one.edges.find((e) => e.relationId === supply)?.sourceField.id, supplyField)
  assert.equal(one.edges.filter((e) => e.relationId === self).length, 1)
  const two = await exploreRelations(companies, { recordIds: [a], direction: 'outgoing', depth: 2 })
  assert(two.nodes.some((n) => n.id === product))
  assert(!two.nodes.some((n) => n.id === category))
  const three = await exploreRelations(companies, {
    recordIds: [a],
    direction: 'outgoing',
    depth: 3,
  })
  assert(three.nodes.some((n) => n.id === category))
  assert(!three.nodes.some((n) => n.id === secret))
  assert.equal(three.limited, false)
  const incoming = await exploreRelations(suppliers, {
    recordIds: [supplier],
    direction: 'incoming',
  })
  assert.deepEqual(new Set(incoming.nodes.map((n) => n.id)), new Set([supplier, a, b]))
  assert.equal(incoming.evidence, 'stored-relations')
})

test('selected relations and domains compose a query without persisting inferred edges', async () => {
  const before = (await pool.query('SELECT count(*) FROM iw_data.changes')).rows[0].count
  const filtered = await exploreRelations(companies, {
    recordIds: [a, b],
    depth: 3,
    relationIds: [supply],
  })
  assert.equal(filtered.nodes.length, 3)
  assert.equal(filtered.edges.length, 2)
  assert.equal(filtered.nodes.filter((n) => n.root).length, 2)
  const domain = await exploreRelations(companies, {
    recordIds: [a],
    depth: 3,
    tableIds: [suppliers],
    direction: 'outgoing',
  })
  assert.deepEqual(new Set(domain.nodes.map((n) => n.id)), new Set([a, supplier]))
  assert.equal(
    (await exploreRelations(companies, { recordIds: [a], relationIds: [] })).edges.length,
    0,
  )
  assert.equal((await pool.query('SELECT count(*) FROM iw_data.changes')).rows[0].count, before)
  await assert.rejects(exploreRelations(companies, { recordIds: [a], tableIds: [outside] }), /范围/)
  await assert.rejects(
    exploreRelations(companies, { recordIds: [a], relationIds: [external] }),
    /范围/,
  )
  await assert.rejects(exploreRelations(companies, { recordIds: [secret] }), /起点/)
})

test('UI and MCP use the same graph query, independent of the view extension', async () => {
  await changeExtension('relations', 'install')
  await changeExtension('relations', 'disable')
  const client = new Client({ name: 'onto-exploration-test', version: '1.0.0' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost/api/projects/${projects[0]}/mcp`),
        {
          fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
        },
      ),
    )
    const tools = await client.listTools()
    assert(tools.tools.find((t) => t.name === 'relation_explore')?.annotations?.readOnlyHint)
    const catalog = await client.callTool({ name: 'business_catalog', arguments: {} })
    assert.equal((catalog.structuredContent as any).result.tables.length, 4)
    assert(!JSON.stringify(catalog.structuredContent).includes(external))
    const search = await client.callTool({ name: 'records_find', arguments: { query: 'Alp' } })
    assert.deepEqual(
      (search.structuredContent as any).result.records.map((r: any) => r.id),
      [a],
    )
    const input = { recordIds: [a], depth: 2, direction: 'outgoing' }
    const response = await post(`/tables/${companies}/graph/explore`, input)
    assert.equal(response.status, 200)
    const ui = await response.json()
    const result = await client.callTool({
      name: 'relation_explore',
      arguments: { tableId: companies, ...input },
    })
    assert.notEqual(result.isError, true)
    assert.deepEqual((result.structuredContent as any).result.nodes, ui.nodes)
    assert.deepEqual((result.structuredContent as any).result.edges, ui.edges)
    assert.deepEqual(explorationFromHash(ui.navigation.href.slice(1)), ui.query)
    assert.equal(
      (await post(`/tables/${companies}/graph/explore`, { recordIds: [a], depth: 4 })).status,
      400,
    )
  } finally {
    await client.close()
    await changeExtension('relations', 'enable')
  }
})

test('single-table scope hides outside relationships and retains its scope in the graph link', async () => {
  const service = await integration({ kind: 'table', id: companies })
  const graph = (await service.execute('relation_explore', { recordIds: [a], depth: 3 })) as any
  assert.deepEqual(
    graph.nodes.map((n: any) => n.id),
    [a],
  )
  assert.deepEqual(graph.query.tableIds, [companies])
  const replay = explorationFromHash(graph.navigation.href.slice(1))!
  assert.deepEqual((await exploreRelations(companies, replay)).edges, graph.edges)
  await assert.rejects(
    service.execute('relation_explore', { recordIds: [a], relationIds: [supply] }),
    /范围/,
  )
  const search = (await service.execute('records_find', { query: 'Shared' })) as any
  assert.equal(search.records.length, 0)
})

test('multiple starts preserve disconnected records in the view and invalid deep links cannot run', async () => {
  const graph = await exploreRelations(companies, {
    recordIds: [a, isolated],
    relationIds: [supply],
  })
  const merged = mergeExploration(
    [graph],
    graph.nodes.find((n) => n.id === a)!,
    100,
    200,
    [a, isolated],
  )
  assert(merged.nodes.some((n: any) => n.id === isolated && n.root))
  assert.equal(explorationFromHash('#view=relations&explore=%7Bbroken'), undefined)
  assert.equal(
    explorationFromHash(
      '#view=relations&explore=' +
        encodeURIComponent(JSON.stringify({ recordIds: [a], depth: 99 })),
    ),
    undefined,
  )
  assert.equal(explorationInput.safeParse({ recordIds: [a], sql: 'select *' }).success, false)
})

test('large fanout reports node and edge truncation without returning dangling links', async () => {
  const ids: string[] = []
  for (let i = 0; i < 24; i++) ids.push(await row(suppliers, `Fanout-${i}`))
  await link(companies, a, supplyField, ids)
  for (const limits of [
    { nodeLimit: 10, edgeLimit: 200 },
    { nodeLimit: 100, edgeLimit: 10 },
  ]) {
    const graph = await exploreRelations(companies, {
      recordIds: [a],
      relationIds: [supply],
      depth: 3,
      ...limits,
    })
    assert.equal(graph.limited, true)
    assert(graph.nodes.length <= limits.nodeLimit)
    assert(graph.edges.length <= limits.edgeLimit)
    const visible = new Set(graph.nodes.map((n) => n.id))
    assert(graph.edges.every((e) => visible.has(e.source) && visible.has(e.target)))
  }
  if (pool.dialect === 'sqlite') {
    const plan = await pool.query('EXPLAIN QUERY PLAN ' + sqliteExplorationEdgesSql, [[supply], [a], 11, [], 'both'])
    const explanation = JSON.stringify(plan.rows)
    assert.match(explanation, /sqlite_autoindex_links_1/)
    assert.match(explanation, /link_reverse_idx/)
    return
  }
  // Inspect the real access path with enough irrelevant edges to require indexed lookups.
  const title = (await store.getTableSchema(companies)).fields.find((f) => f.isPrimary)!
  await transaction(async (db) => {
    const ids = (
      await db.query(
        'INSERT INTO iw_data.record_index(id,table_id) SELECT gen_random_uuid(),$1 FROM generate_series(1,500) RETURNING id',
        [companies],
      )
    ).rows.map((r) => r.id)
    await db.query(
      `INSERT INTO iw_data.${identifier(companies)} (_record_id,${identifier(title.id, 'f')}) SELECT id,'Plan-'||id::text FROM unnest($1::uuid[]) t(id)`,
      [ids],
    )
  })
  await pool.query(
    `INSERT INTO iw_data.links(relation_id,source_id,target_id)
    SELECT $1,s.id,t.id FROM iw_data.record_index s CROSS JOIN iw_data.record_index t
    WHERE s.table_id=$2 AND t.table_id=$3 ON CONFLICT DO NOTHING`,
    [supply, companies, suppliers],
  )
  await pool.query('ANALYZE iw_data.links')
  const plan = await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + explorationEdgesSql, [
    [supply],
    [a],
    11,
    [],
    'both',
  ])
  const explanation = JSON.stringify(plan.rows[0]['QUERY PLAN'][0].Plan)
  assert.match(explanation, /links_pkey/)
  assert.match(explanation, /link_reverse_idx/)
  console.info(
    'Exploration plan uses links_pkey and link_reverse_idx; execution ms:',
    plan.rows[0]['QUERY PLAN'][0]['Execution Time'],
  )
})
