import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { migrate, pool } from '../src/server/db'
import * as store from '../src/server/store'
import { app } from '../src/server/app'
import type { FieldDef, TableData } from '../src/core/contracts'

let project: string, secondProject: string, source: string, target: string
let title: FieldDef, note: FieldDef, relation: FieldDef
let root: string, other: string
const children: string[] = []
before(async () => {
  await migrate()
  project = (
    await store.createProject(store.projectInput.parse({ name: `详情测试-${randomUUID()}` }))
  ).id
  secondProject = (
    await store.createProject(store.projectInput.parse({ name: `关联目标-${randomUUID()}` }))
  ).id
  source = (await store.createTable(project, store.tableInput.parse({ name: '客户' }))).id
  target = (await store.createTable(secondProject, store.tableInput.parse({ name: '订单' }))).id
  title = (await store.getTableSchema(source)).fields[0]
  note = (await store.createField(
    source,
    store.fieldInput.parse({ name: '备注', type: 'longtext' }),
  ))!
  relation = (await store.createField(
    source,
    store.fieldInput.parse({
      name: '订单',
      type: 'relation',
      targetTableId: target,
      reverseName: '客户',
      multiple: true,
    }),
  ))!
  const reverse = (await store.getTableSchema(target)).fields.find((f) => f.type === 'relation')!
  root = await store.saveRecord(source, { values: { [title.id]: '公司', [note.id]: '保留的备注' } })
  other = await store.saveRecord(source, { values: {} })
  for (let i = 0; i < 53; i++)
    children.push(await store.saveRecord(target, { values: { [reverse.id]: [root] } }))
  await store.saveRecord(target, { values: { [reverse.id]: [other] } })
})
after(async () => {
  try {
    if (project) await store.deleteProject(project)
    if (secondProject) await store.deleteProject(secondProject)
  } finally {
    await pool.end()
  }
})
const patch = (path: string, body: unknown) =>
  app.request(`http://localhost/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

test('detail order is persisted independently; validates table fields and rejects stale concurrent writes', async () => {
  const schema = await store.getTableSchema(source)
  const originalOrder = schema.fields.map((f) => f.id)
  const request = { fieldOrder: [note.id, title.id], version: schema.version }
  const results = await Promise.all([
    patch(`/tables/${source}/detail-layout`, request),
    patch(`/tables/${source}/detail-layout`, request),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
  const current = await store.getTableSchema(source)
  assert.deepEqual(current.detailLayout?.fieldOrder, request.fieldOrder)
  assert.deepEqual(
    current.fields.map((f) => f.id),
    originalOrder,
  )
  assert.equal(current.fields.find((f) => f.isPrimary)?.id, title.id)
  for (const fieldOrder of [
    [title.id, title.id],
    [randomUUID(), title.id],
    [title.id],
    [title.id, note.id, relation.id],
  ]) {
    const response = await patch(`/tables/${source}/detail-layout`, {
      fieldOrder,
      version: current.version,
    })
    assert.ok(response.status === 400 || response.status === 409)
  }
  assert.deepEqual((await store.getData(source)).table.detailLayout, current.detailLayout)
})

test('related detail reads use canonical links, paginate across projects and reject unrelated identifiers', async () => {
  const url = `/api/tables/${source}/records/${root}/relations/${relation.id}`
  const firstResponse = await app.request(`http://localhost${url}`)
  assert.equal(firstResponse.status, 200)
  const first = (await firstResponse.json()) as TableData
  const second = (await (await app.request(`http://localhost${url}?page=2`)).json()) as TableData
  assert.equal(first.table.id, target)
  assert.equal(first.total, 53)
  assert.equal(first.records.length, 50)
  assert.equal(second.records.length, 3)
  assert.deepEqual(
    new Set([...first.records, ...second.records].map((r) => r.id)),
    new Set(children),
  )
  const reverse = first.fields.find((f) => f.type === 'relation')!
  assert.equal((await store.getRelatedData(target, children[0], reverse.id)).records[0].id, root)
  assert.equal((await app.request(`http://localhost${url}?page=0`)).status, 400)
  assert.equal(
    (
      await app.request(
        `http://localhost/api/tables/${target}/records/${root}/relations/${relation.id}`,
      )
    ).status,
    404,
  )
  assert.equal(
    (
      await app.request(
        `http://localhost/api/tables/${source}/records/${root}/relations/${note.id}`,
      )
    ).status,
    404,
  )
  assert.equal((await store.getRelatedData(source, other, relation.id)).total, 1)
})

test('single-cell patches preserve other fields and relations and reject stale versions', async () => {
  const record = (await store.getData(source, 1, '', root)).records[0]
  const update = { version: record.version, values: { [title.id]: '新公司名' } }
  assert.equal((await patch(`/tables/${source}/records/${root}`, update)).status, 200)
  assert.equal((await patch(`/tables/${source}/records/${root}`, update)).status, 409)
  const next = (await store.getData(source, 1, '', root)).records[0]
  assert.equal(next.values[note.id], '保留的备注')
  assert.equal((next.values[relation.id] as unknown[]).length, 53)
})
