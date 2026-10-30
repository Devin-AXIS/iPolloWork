import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { app } from '../src/server/app'
import { migrate, pool } from '../src/server/db'
import * as store from '../src/server/store'
import { integration } from '../src/server/integration'

const projects: string[] = []
before(async () => {
  await migrate()
  for (let i = 0; i < 2; i++)
    projects.push(
      (
        await store.createProject(
          store.projectInput.parse({ name: `Live verification ${randomUUID()}` }),
        )
      ).id,
    )
})
after(async () => {
  for (const id of projects) await store.deleteProject(id)
  await pool.end()
})
type Event = { type: string; data: Record<string, unknown> }
async function subscribe(id: string, workbenchId?: string) {
  const response = await app.request(
    `http://localhost/api/projects/${id}/changes${workbenchId ? `?workbenchId=${workbenchId}` : ''}`,
  )
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type')!, /text\/event-stream/)
  const events: Event[] = []
  const reader = response.body!.getReader()
  const pump = (async () => {
    let text = ''
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      text += decoder.decode(value, { stream: true })
      let end: number
      while ((end = text.indexOf('\n\n')) >= 0) {
        const frame = text.slice(0, end)
        text = text.slice(end + 2)
        const type = frame.match(/^event: (.+)$/m)?.[1]
        const data = frame.match(/^data: (.+)$/m)?.[1]
        if (type && data) events.push({ type, data: JSON.parse(data) })
      }
    }
  })()
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return
      await delay(10)
    }
    assert.fail('Expected project event was not received')
  }
  await until(() => events.some((e) => e.type === 'change'))
  return {
    events,
    until,
    close: async () => {
      await reader.cancel()
      await pump
    },
  }
}

test('preset builds follow the committed main table only in the bound conversation', async () => {
  const workbench = { id: randomUUID() }
  const own = await subscribe(projects[1], workbench.id)
  const other = await subscribe(projects[1], randomUUID())
  const execute = async (name: string, input: unknown) =>
    (await integration({ kind: 'project', id: projects[1] })).execute(name, input)
  const input = { preset: 'orders', requestId: randomUUID(), workbench }
  try {
    await execute('table_preset_preview', input)
    await own.until(() => own.events.some((e) => e.data.phase === 'complete'))
    assert.equal(own.events.filter((e) => e.type === 'change').length, 1)
    assert.ok(own.events.filter((e) => e.data.phase === 'complete').every((e) => !e.data.focus))
    const built = (await execute('table_preset_apply', input)) as { navigation: { href: string } }
    await own.until(() =>
      own.events.some(
        (e) => e.data.operation === 'table_preset_apply' && e.data.phase === 'complete',
      ),
    )
    const completed = own.events.find(
      (e) => e.data.operation === 'table_preset_apply' && e.data.phase === 'complete',
    )!
    assert.equal(completed.data.tables, 3)
    assert.equal((completed.data.focus as { href: string }).href, built.navigation.href)
    await other.until(() => other.events.filter((e) => e.type === 'change').length > 1)
    assert.ok(!other.events.some((e) => e.type === 'activity'))
  } finally {
    await own.close()
    await other.close()
  }
})

test('real build and progressive writes notify only their project, with commit receipts and safe retry', async () => {
  const own = await subscribe(projects[0]),
    other = await subscribe(projects[1])
  const execute = async (name: string, input: unknown) =>
    (await integration({ kind: 'project', id: projects[0] })).execute(name, input)
  try {
    const blueprint = {
      schemaVersion: 1,
      requestId: randomUUID(),
      tables: [
        {
          key: 'customers',
          name: '客户',
          fields: [
            { key: 'domain', name: '域名', type: 'text' },
            { key: 'note', name: '备注', type: 'text' },
          ],
        },
      ],
      relations: [],
    }
    const preview = (await execute('schema_preview', blueprint)) as { preview: boolean }
    assert.equal(preview.preview, true)
    assert.equal((await store.getSchema(projects[0])).tables.length, 0)
    await own.until(() =>
      own.events.some((e) => e.data.operation === 'schema_preview' && e.data.phase === 'complete'),
    )
    assert.equal(own.events.filter((e) => e.type === 'change').length, 1)

    const built = (await execute('schema_apply', blueprint)) as {
      tables: { id: string; fieldIds: Record<string, string> }[]
      navigation: { href: string }
    }
    const table = built.tables[0]
    assert.equal(built.navigation.href, `/#project=${projects[0]}&table=${table.id}`)
    const input = {
      requestId: randomUUID(),
      keyFieldId: table.fieldIds.domain,
      rows: [{ [table.fieldIds.domain]: 'one.example', [table.fieldIds.note]: '保留人工备注' }],
    }
    const first = (await execute('records_import', { tableId: table.id, input })) as {
      ids: string[]
      created: number
    }
    assert.equal(first.created, 1)
    assert.equal((await store.getData(table.id)).total, 1)
    const second = (await execute('records_import', {
      tableId: table.id,
      input: {
        ...input,
        requestId: randomUUID(),
        rows: [
          { [table.fieldIds.domain]: 'one.example' },
          { [table.fieldIds.domain]: 'two.example' },
        ],
      },
    })) as { created: number; updated: number }
    assert.equal(second.created, 1)
    assert.equal(second.updated, 1)
    assert.equal((await store.getData(table.id)).total, 2)
    assert.equal(
      (await store.getData(table.id, 1, '', first.ids[0])).records[0].values[table.fieldIds.note],
      '保留人工备注',
    )
    const replay = (await execute('records_import', { tableId: table.id, input })) as {
      replayed: boolean
    }
    assert.equal(replay.replayed, true)
    assert.equal((await store.getData(table.id)).total, 2)
    await own.until(() => own.events.some((e) => e.data.replayed === true))
    const committedChanges = own.events.filter((e) => e.type === 'change').length
    await execute('records_list', { tableId: table.id })
    await assert.rejects(() =>
      execute('record_update', {
        tableId: table.id,
        recordId: first.ids[0],
        version: 9999,
        values: { [table.fieldIds.note]: 'must not overwrite' },
      }),
    )
    await own.until(() => own.events.some((e) => e.data.phase === 'failed'))
    assert.equal(own.events.filter((e) => e.type === 'change').length, committedChanges)
    assert.equal(
      (await store.getData(table.id, 1, '', first.ids[0])).records[0].values[table.fieldIds.note],
      '保留人工备注',
    )
    assert.equal(other.events.length, 1)
    assert(own.events.some((e) => e.data.phase === 'running'))
    assert(own.events.some((e) => e.data.created === 1 && e.data.updated === 1))
    assert(!JSON.stringify(own.events).includes('one.example'))
    assert(!JSON.stringify(own.events).includes(table.id))
  } finally {
    await own.close()
    await other.close()
  }
  // A reconnect invalidates stale UI without retaining task history or subscribing elsewhere.
  const resumed = await subscribe(projects[0])
  assert.deepEqual(resumed.events, [{ type: 'change', data: {} }])
  await resumed.close()
})

test('event endpoint rejects unknown projects and foreign origins without widening access', async () => {
  const missing = await app.request(`http://localhost/api/projects/${randomUUID()}/changes`)
  assert.equal(missing.status, 404)
  const denied = await app.request(`http://localhost/api/projects/${projects[0]}/changes`, {
    headers: { Origin: 'https://foreign.example' },
  })
  assert.equal(denied.status, 403)
})

test('a bound conversation follows its own committed tables, records and document blocks', async () => {
  const channel = randomUUID(),
    otherChannel = randomUUID()
  const own = await subscribe(projects[0], channel),
    other = await subscribe(projects[0], otherChannel)
  const execute = async (name: string, input: Record<string, unknown>) =>
    (await integration({ kind: 'project', id: projects[0] })).execute(name, {
      ...input,
      workbench: { id: channel },
    })
  try {
    const built = (await execute('schema_apply', {
      schemaVersion: 1,
      requestId: randomUUID(),
      tables: [
        {
          key: 'leads',
          name: 'Follow test ' + channel,
          fields: [{ key: 'name', name: '名称', type: 'text' }],
        },
      ],
      relations: [],
    })) as { tables: { id: string; fieldIds: Record<string, string> }[] }
    const table = built.tables[0]
    const batch = (await execute('records_import', {
      tableId: table.id,
      input: {
        requestId: randomUUID(),
        keyFieldId: table.fieldIds.name,
        rows: Array.from({ length: 65 }, (_, index) => ({
          [table.fieldIds.name]: 'Verified customer ' + index,
        })),
      },
    })) as { ids: string[] }
    await own.until(() =>
      own.events.some(
        (event) => event.data.operation === 'records_import' && event.data.phase === 'complete',
      ),
    )
    const receipt = own.events.find(
      (event) => event.data.operation === 'records_import' && event.data.phase === 'complete',
    )!.data
    assert.equal(receipt.workbenchId, channel)
    assert.equal((receipt.focus as { page: number }).page, 2)
    assert.equal((receipt.focus as { recordIds: string[] }).recordIds.length, 65)
    const doc = (await execute('document_create', {
      tableId: table.id,
      recordId: batch.ids[0],
      input: {
        title: '客户研究',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'summary' },
              content: [{ type: 'text', text: '真实测试资料' }],
            },
          ],
        },
      },
    })) as { id: string; version: number }
    await execute('document_update', {
      tableId: table.id,
      recordId: batch.ids[0],
      documentId: doc.id,
      input: {
        version: doc.version,
        operations: [
          {
            op: 'replace',
            blockId: 'summary',
            block: { type: 'paragraph', content: [{ type: 'text', text: '已补充的资料' }] },
          },
        ],
      },
    })
    await own.until(() =>
      own.events.some(
        (event) => event.data.operation === 'document_update' && event.data.phase === 'complete',
      ),
    )
    const focus = own.events.find(
      (event) => event.data.operation === 'document_update' && event.data.phase === 'complete',
    )!.data.focus as Record<string, unknown>
    assert.equal(focus.documentId, doc.id)
    assert.equal(focus.recordId, batch.ids[0])
    assert.equal(focus.blockId, 'summary')
    assert(!JSON.stringify(own.events).includes('已补充的资料'))
    assert(!other.events.some((event) => event.type === 'activity'))
    assert(other.events.some((event) => event.type === 'change'))
    await assert.rejects(() =>
      execute('record_update', {
        tableId: table.id,
        recordId: batch.ids[0],
        version: 999999,
        values: { [table.fieldIds.name]: 'must not save' },
      }),
    )
    await own.until(() => own.events.some((event) => event.data.phase === 'failed'))
    assert(
      !own.events
        .filter((event) => event.data.phase === 'failed')
        .some((event) => event.data.focus),
    )
  } finally {
    await own.close()
    await other.close()
  }
})
