import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { app } from '../src/server/app'
import { pool, migrate } from '../src/server/db'
import * as store from '../src/server/store'
import { integration, integrationOpenApi } from '../src/server/integration'
import { presetBlueprint, tablePresetInput } from '../src/core/table-presets'
import type { BlueprintResult } from '../src/core/blueprint'

const projects: string[] = []
before(() => migrate())
after(async () => {
  for (const id of projects.reverse()) await store.deleteProject(id)
  await pool.end()
})
async function project() {
  const p = await store.createProject(
    store.projectInput.parse({ name: `Preset check ${randomUUID()}` }),
  )
  projects.push(p.id)
  return p.id
}
async function execute(id: string, name: string, input: unknown) {
  const response = await app.request(`http://localhost/api/projects/${id}/operations/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return { status: response.status, result: await response.json() }
}
async function apply(id: string, input: unknown): Promise<BlueprintResult> {
  const response = await execute(id, 'table_preset_apply', input)
  assert.equal(response.status, 200, JSON.stringify(response.result))
  return response.result
}

test('preview is disposable; concurrent apply reuses one receipt and creates canonical bidirectional relations', async () => {
  const id = await project()
  const input = { preset: 'orders', requestId: randomUUID(), workbench: { id: randomUUID() } }
  const preview = await execute(id, 'table_preset_preview', input)
  assert.equal(preview.status, 200)
  assert.equal(preview.result.preview, true)
  assert.equal(preview.result.tables.length, 3)
  assert.equal((await store.getSchema(id)).tables.length, 0)
  const [first, second] = await Promise.all([apply(id, input), apply(id, input)])
  assert.equal(first.replayed !== second.replayed, true)
  assert.deepEqual(first.tables, second.tables)
  const tables = (await store.getSchema(id)).tables
  assert.equal(tables.length, 3)
  const order = first.tables.find((t) => t.key === 'orders')!
  const user = first.tables.find((t) => t.key === 'users')!
  const product = first.tables.find((t) => t.key === 'products')!
  assert.equal(tables.find((t) => t.id === user.id)!.icon, 'people')
  const userId = await store.saveRecord(user.id, { values: { [user.fieldIds.name]: '测试用户' } })
  const productId = await store.saveRecord(product.id, {
    values: { [product.fieldIds.name]: '测试课程', [product.fieldIds.price]: '99.00' },
  })
  const orderId = await store.saveRecord(order.id, {
    values: {
      [order.fieldIds.number]: 'TEST-1',
      [order.fieldIds.customer]: [userId],
      [order.fieldIds.product]: [productId],
      [order.fieldIds.quantity]: '2',
      [order.fieldIds.unitPrice]: '99.00',
    },
  })
  const productData = await store.getData(product.id)
  const productReverse = productData.fields.find((f) => f.targetTableId === order.id)!
  assert.equal(productReverse.multiple, true)
  assert.equal(
    (productData.records[0].values[productReverse.id] as { id: string }[])[0].id,
    orderId,
  )
  const orderData = await store.getData(order.id)
  assert.equal(orderData.fields.find((f) => f.id === order.fieldIds.product)!.multiple, false)
  assert.equal(Number(orderData.records[0].values[order.fieldIds.quantity]), 2)
  assert.equal(Number(orderData.records[0].values[order.fieldIds.unitPrice]), 99)
  const data = await store.getData(user.id)
  const reverse = data.fields.find((f) => f.targetTableId === order.id)!
  assert.equal(reverse.multiple, true)
  assert.equal((data.records[0].values[reverse.id] as { id: string }[])[0].id, orderId)
  // Normal tables remain extensible and records retain their original values.
  await store.createField(user.id, store.fieldInput.parse({ name: '自定义标签', type: 'tags' }))
  assert.equal((await store.getData(user.id)).records[0].values[user.fieldIds.name], '测试用户')
  const collision = await execute(id, 'table_preset_apply', { ...input, name: '另一个订单' })
  assert.equal(collision.status, 409)
  assert.equal((await store.getSchema(id)).tables.length, 3)
})

test('binds existing tables by ID; failed versions roll back every new table and relation', async () => {
  const id = await project()
  const users = (await apply(id, { preset: 'users', requestId: randomUUID(), name: '会员' }))
    .tables[0]
  const products = (
    await apply(id, { preset: 'products', requestId: randomUUID(), name: '课程商品' })
  ).tables[0]
  const schema = (await store.getSchema(id)).tables
  const bindings = {
    users: { tableId: users.id, version: schema.find((t) => t.id === users.id)!.version },
    products: { tableId: products.id, version: schema.find((t) => t.id === products.id)!.version },
  }
  const input = { preset: 'orders', requestId: randomUUID(), name: '课程订单', bindings }
  const result = await apply(id, input)
  assert.deepEqual(
    result.tables.map((t) => t.key),
    ['orders'],
  )
  assert.equal((await store.getSchema(id)).tables.length, 3)
  assert.equal((await apply(id, input)).replayed, true)
  const rejected = await execute(id, 'table_preset_apply', {
    ...input,
    name: '过期订单',
    requestId: randomUUID(),
  })
  assert.equal(rejected.status, 409)
  assert.equal((await store.getSchema(id)).tables.length, 3)
  assert.equal(
    (await store.getTableSchema(users.id)).fields.filter((f) => f.type === 'relation').length,
    1,
  )
})

test('enforces project scope and rejects irrelevant bindings; general tables preserve custom name/icon', async () => {
  const id = await project(),
    other = await project()
  const external = (await apply(other, { preset: 'users', requestId: randomUUID() })).tables[0]
  const bindings = {
    users: { tableId: external.id, version: (await store.getTableSchema(external.id)).version },
  }
  assert.equal(
    (
      await execute(id, 'table_preset_apply', {
        preset: 'orders',
        requestId: randomUUID(),
        bindings,
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await execute(id, 'table_preset_apply', {
        preset: 'general',
        requestId: randomUUID(),
        bindings,
      })
    ).status,
    400,
  )
  assert.equal((await store.getSchema(id)).tables.length, 0)
  const created = await apply(id, {
    preset: 'general',
    requestId: randomUUID(),
    name: '我的通用表',
    icon: 'heart',
  })
  const table = await store.getTableSchema(created.tables[0].id)
  assert.equal(table.name, '我的通用表')
  assert.equal(table.icon, 'heart')
  assert.equal(table.fields.length, 1)
  const scoped = await integration({ kind: 'table', id: table.id })
  assert.ok(!scoped.operations.some((op) => op.name.startsWith('table_preset')))
  const plan = presetBlueprint(
    tablePresetInput.parse({ preset: 'orders', name: '长'.repeat(80), requestId: randomUUID() }),
    id,
  )
  assert.ok(plan.tables[1].name.length <= 80)
  assert.notEqual(plan.tables[0].name, plan.tables[1].name)
})

test('API/OpenAPI and real MCP expose the same typed presets and create a usable table', async () => {
  const id = await project()
  const catalog = await execute(id, 'table_presets', { locale: 'en' })
  assert.deepEqual(
    catalog.result.presets.map((p: { id: string }) => p.id),
    ['general', 'users', 'products', 'orders'],
  )
  assert.equal(catalog.result.presets[1].fields[1].name, 'Avatar')
  assert.deepEqual(catalog.result.rules.orders.creates, ['orders'])
  assert.equal(catalog.result.rules.orders.oneProductPerOrder, true)
  const openapi = await integrationOpenApi({ kind: 'project', id })
  const endpoint = openapi.paths[`/api/projects/${id}/operations/table_preset_apply`].post
  assert.equal(endpoint['x-idempotent'], true)
  assert.equal(endpoint['x-read-only'], false)
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const client = new Client({ name: 'preset-test', version: '1.0.0' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/api/projects/${id}/mcp`),
      ),
    )
    const tools = await client.listTools()
    assert.ok(tools.tools.some((tool) => tool.name === 'table_preset_apply'))
    const input = { preset: 'users', requestId: randomUUID(), locale: 'en' }
    const preview = await client.callTool({ name: 'table_preset_preview', arguments: input })
    assert.ok(!preview.isError)
    assert.equal((await store.getSchema(id)).tables.length, 0)
    const built = await client.callTool({ name: 'table_preset_apply', arguments: input })
    assert.ok(!built.isError, JSON.stringify(built))
    const table = (await store.getSchema(id)).tables[0]
    assert.equal(table.name, 'Users')
    assert.deepEqual(
      table.fields.map((field) => field.name),
      ['Name', 'Avatar', 'Phone', 'Email', 'Status'],
    )
    const replay = await client.callTool({ name: 'table_preset_apply', arguments: input })
    assert.equal((replay.structuredContent as { result: BlueprintResult }).result.replayed, true)
  } finally {
    await client.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
