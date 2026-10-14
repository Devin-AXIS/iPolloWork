import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { migrate, pool } from '../src/server/db'
import * as store from '../src/server/store'
import * as docs from '../src/server/documents'
import { integration, integrationOpenApi } from '../src/server/integration'
import { app } from '../src/server/app'
import type { DocumentContent } from '../src/core/documents'
import { unzipSync, strFromU8 } from 'fflate'
let project: string,
  foreignProject: string,
  table: string,
  other: string,
  foreign: string,
  record: string,
  otherRecord: string,
  foreignRecord: string
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const content = (text: string): DocumentContent => ({ type: 'doc', content: [para(text)] })
const request = (url: string, method = 'GET', body?: unknown) =>
  app.request(`http://localhost/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
let base: string
before(async () => {
  await migrate()
  project = (
    await store.createProject(store.projectInput.parse({ name: `文档测试-${randomUUID()}` }))
  ).id
  foreignProject = (
    await store.createProject(store.projectInput.parse({ name: `文档隔离-${randomUUID()}` }))
  ).id
  table = (await store.createTable(project, store.tableInput.parse({ name: '公司' }))).id
  other = (await store.createTable(project, store.tableInput.parse({ name: '项目' }))).id
  foreign = (await store.createTable(foreignProject, store.tableInput.parse({ name: '范围外' }))).id
  record = await store.saveRecord(table, { values: {} })
  otherRecord = await store.saveRecord(other, { values: {} })
  foreignRecord = await store.saveRecord(foreign, { values: {} })
  for (let i = 0; i < 52; i++) await store.saveRecord(other, { values: {} })
  base = `/tables/${table}/records/${record}/documents`
})
after(async () => {
  try {
    if (project) await store.deleteProject(project)
    if (foreignProject) await store.deleteProject(foreignProject)
  } finally {
    await pool.end()
  }
})
test('documents are lazily created, metadata-only in lists, independently versioned and share a canonical body', async () => {
  const scope = { tableId: table, recordId: record },
    target = { tableId: other, recordId: otherRecord }
  assert.deepEqual(await docs.listDocuments(scope), [])
  const before = (await store.getData(table, 1, '', record)).records[0]
  const id = randomUUID()
  const a = await docs.createDocument(scope, { id, title: '研究', content: content('first') })
  const retry = await docs.createDocument(scope, { id, title: '研究', content: content('first') })
  assert.equal(retry.id, a.id)
  assert.equal((await docs.listDocuments(scope)).length, 1)
  assert.ok(a.content.content[0].attrs?.id)
  assert.equal('content' in (await docs.listDocuments(scope))[0], false)
  await docs.attachDocument(target, a.id)
  const update = {
    version: a.version,
    operations: [
      { op: 'replace', blockId: a.content.content[0].attrs!.id, block: para('shared edit') },
    ],
  }
  const responses = await Promise.all([
    request(`${base}/${a.id}`, 'PATCH', update),
    request(`${base}/${a.id}`, 'PATCH', update),
  ])
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409])
  assert.equal(
    (await docs.getDocument(target, a.id)).content.content[0].content?.[0].text,
    'shared edit',
  )
  const after = (await store.getData(table, 1, '', record)).records[0]
  assert.equal(after.version, before.version)
  assert.deepEqual(after.values, before.values)
  assert.equal('content' in after, false)
  await docs.detachDocument(scope, a.id)
  await assert.rejects(docs.getDocument(scope, a.id), /不在/)
  assert.equal((await docs.getDocument(target, a.id)).linkedRecords, 1)
  await docs.attachDocument(scope, a.id)
  assert.equal((await docs.getDocument(scope, a.id)).linkedRecords, 2)
})
test('cross-table references reuse SQL pagination; project and MCP table boundaries are enforced', async () => {
  const scope = { tableId: table, recordId: record }
  const doc = await docs.createDocument(scope, {
    title: '引用',
    content: { type: 'doc', content: [{ type: 'dataTable', attrs: { tableId: other } }] },
  })
  const first = await docs.documentTable(scope, { tableId: other }, 1)
  const second = await docs.documentTable(scope, { tableId: other }, 2)
  assert.equal(first.records.length, 50)
  assert.equal(second.records.length, 3)
  assert.ok(first.fields.length <= 6)
  await assert.rejects(
    docs.createDocument(scope, {
      title: '越界',
      content: { type: 'doc', content: [{ type: 'dataTable', attrs: { tableId: foreign } }] },
    }),
    /当前项目/,
  )
  await assert.rejects(
    docs.attachDocument({ tableId: foreign, recordId: foreignRecord }, doc.id),
    /当前项目/,
  )
  const mcp = await integration({ kind: 'table', id: table })
  await assert.rejects(
    mcp.execute('document_table', { recordId: record, config: { tableId: other } }),
    /范围/,
  )
  await assert.rejects(
    mcp.execute('document_get', { recordId: otherRecord, documentId: doc.id }),
    /记录不存在/,
  )
  const schema = await integrationOpenApi({ kind: 'table', id: table })
  assert.ok(schema.paths[`/api/tables/${table}/operations/document_update`])
  const get = await mcp.execute('document_get', { recordId: record, documentId: doc.id })
  assert.ok(get)
  const api = await request(`/projects/${project}/openapi.json`)
  assert.equal(api.status, 200)
})
test('interactive references expose the full grid and create canonical reverse links without changing document content', async () => {
  const tasks = (await store.createTable(project, store.tableInput.parse({ name: '交互任务' }))).id
  for (let i = 0; i < 7; i++)
    await store.createField(
      tasks,
      store.fieldInput.parse({
        name: `说明 ${i}`,
        type: i === 6 ? 'longtext' : 'text',
      }),
    )
  const relation = await store.createField(
    table,
    store.fieldInput.parse({
      name: '交互任务',
      type: 'relation',
      targetTableId: tasks,
      reverseName: '所属公司',
      multiple: true,
    }),
  )
  const config = { tableId: table, recordId: record, relationFieldId: relation!.id }
  const document = await docs.createDocument(
    { tableId: table, recordId: record },
    {
      title: '交互引用',
      content: { type: 'doc', content: [{ type: 'dataTable', attrs: config }] },
    },
  )
  const response = await request(`${base}/table`, 'POST', { config, interactive: true })
  assert.equal(response.status, 200)
  const grid = await response.json()
  const schema = await store.getTableSchema(tasks)
  assert.equal(grid.table.id, tasks)
  assert.deepEqual(
    grid.fields.map((f: { id: string }) => f.id),
    schema.fields.map((f) => f.id),
  )
  assert.ok(grid.fields.length > 6)
  assert.ok(grid.fields.some((f: { type: string }) => f.type === 'longtext'))
  const inverse = schema.fields.find(
    (f) => f.relationId === relation!.relationId && f.side !== relation!.side,
  )!
  assert.deepEqual(grid.createValues, { [inverse.id]: [record] })
  const primary = schema.fields.find((f) => f.isPrimary)!
  const created = await request(`/tables/${tasks}/records`, 'POST', {
    values: { ...grid.createValues, [primary.id]: '在文档中新增' },
  })
  assert.equal(created.status, 201)
  const newRecord = await created.json()
  const refreshed = await (
    await request(`${base}/table`, 'POST', { config, interactive: true })
  ).json()
  assert.deepEqual(
    refreshed.records.map((r: { id: string }) => r.id),
    [newRecord.id],
  )
  const owner = (await store.getData(table, 1, '', record)).records[0]
  assert.ok((owner.values[relation!.id] as { id: string }[]).some((v) => v.id === newRecord.id))
  const updated = await request(`/tables/${tasks}/records/${newRecord.id}`, 'PATCH', {
    version: refreshed.records[0].version,
    values: { [primary.id]: '文档内编辑已保存' },
  })
  assert.equal(updated.status, 200)
  assert.equal(
    (await store.getData(tasks, 1, '', newRecord.id)).records[0].values[primary.id],
    '文档内编辑已保存',
  )
  const unchanged = await docs.getDocument({ tableId: table, recordId: record }, document.id)
  assert.equal(unchanged.version, document.version)
  assert.deepEqual(unchanged.content, document.content)
  const compact = await docs.documentTable({ tableId: table, recordId: record }, config)
  assert.ok(compact.fields.length <= 6)
  assert.ok(!compact.fields.some((f) => f.type === 'longtext' || f.type === 'relation'))
  assert.equal(
    (await request(`${base}/table`, 'POST', { config: { tableId: foreign }, interactive: true }))
      .status,
    404,
  )
})
test('export escapes content and freezes table references; invalid writes roll back and unlink retains documents', async () => {
  const scope = { tableId: table, recordId: record }
  const doc = await docs.createDocument(scope, {
    title: '<script>alert(1)</script>',
    content: {
      type: 'doc',
      content: [
        para('<img src=x onerror=alert(1)>'),
        { type: 'dataTable', attrs: { tableId: other } },
      ],
    },
  })
  const response = await request(`${base}/${doc.id}/export`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('数据快照'))
  assert.ok(html.includes('50 / 53'))
  assert.equal(
    (
      await request(`${base}/${doc.id}`, 'PATCH', {
        version: doc.version,
        content: {
          type: 'doc',
          content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
        },
      })
    ).status,
    400,
  )
  assert.equal((await docs.getDocument(scope, doc.id)).version, doc.version)
  assert.equal(
    (await request(`${base}/${doc.id}`, 'PATCH', { content: content('no version') })).status,
    400,
  )
  await docs.detachDocument(scope, doc.id)
  assert.ok((await docs.projectDocuments(project)).some((d) => d.id === doc.id))
  assert.equal((await request(`${base}/${doc.id}`)).status, 404)
})

test('version polling and unchanged saves avoid body churn; repeated create IDs cannot be reused for different input', async () => {
  const scope = { tableId: table, recordId: record },
    id = randomUUID()
  const doc = await docs.createDocument(scope, {
    id,
    title: '稳定保存',
    content: content('stable'),
  })
  const head = await request(`${base}/${id}/version`)
  assert.deepEqual(await head.json(), { version: doc.version })
  const unchanged = await docs.updateDocument(scope, id, {
    version: doc.version,
    content: doc.content,
  })
  assert.equal(unchanged.version, doc.version)
  await assert.rejects(
    docs.createDocument(scope, { id, title: '不同请求', content: content('changed') }),
    /创建标识/,
  )
  assert.equal((await docs.getDocument(scope, id)).title, '稳定保存')
})

test('managed images validate bytes, stay project scoped and are embedded in portable exports', async () => {
  const scope = { tableId: table, recordId: record }
  const doc = await docs.createDocument(scope, { title: '图片' })
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
  const upload = await request(`${base}/${doc.id}/images`, 'POST', { data: png })
  assert.equal(upload.status, 201)
  const { src } = (await upload.json()) as { src: string }
  assert.ok(src.startsWith(`/api/projects/${project}/document-images/`))
  assert.equal((await app.request(`http://localhost${src}`)).status, 200)
  await docs.updateDocument(scope, doc.id, {
    version: doc.version,
    content: { type: 'doc', content: [{ type: 'image', attrs: { src, alt: 'image' } }] },
  })
  assert.ok(
    (await (await request(`${base}/${doc.id}/export`)).text()).includes('data:image/png;base64,'),
  )
  const word = await request(`${base}/${doc.id}/export?format=docx`)
  assert.equal(word.status, 200)
  const archive = unzipSync(new Uint8Array(await word.arrayBuffer()))
  const media = Object.keys(archive).find(
    (name) => name.startsWith('word/media/') && name.endsWith('.png'),
  )!
  assert.ok(media)
  assert.deepEqual(Buffer.from(archive[media]), Buffer.from(png, 'base64'))
  assert.match(strFromU8(archive['word/document.xml']), /<w:drawing>/)
  assert.equal(
    (
      await request(`${base}/${doc.id}/images`, 'POST', {
        data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
      })
    ).status,
    400,
  )
  await assert.rejects(
    docs.createDocument(
      { tableId: foreign, recordId: foreignRecord },
      {
        title: '跨项目图片',
        content: { type: 'doc', content: [{ type: 'image', attrs: { src } }] },
      },
    ),
    /当前项目/,
  )
})

test('Word exports editable document blocks and explicit table snapshots without record properties or sibling documents', async () => {
  const exportTable = await store.createTable(
    project,
    store.tableInput.parse({ name: '导出范围测试' }),
  )
  const schema = await store.getTableSchema(exportTable.id)
  const exportRecord = await store.saveRecord(exportTable.id, {
    values: { [schema.fields[0].id]: 'PRIVATE_RECORD_PROPERTY' },
  })
  const scope = { tableId: exportTable.id, recordId: exportRecord }
  await docs.createDocument(scope, {
    title: 'SIBLING_DOCUMENT_SECRET',
    content: content('SIBLING_BODY_SECRET'),
  })
  const doc = await docs.createDocument(scope, { title: '旧标题', content: content('OLD_BODY') })
  await docs.updateDocument(scope, doc.id, {
    version: doc.version,
    title: '企业研究 / 最新版',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '最新正文' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<重要结论>', marks: [{ type: 'bold' }, { type: 'italic' }] },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: '来源',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/research' } }],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [para('第一项')] },
            { type: 'listItem', content: [para('第二项')] },
          ],
        },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('确认完成')] }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', attrs: { colspan: 2 }, content: [para('合并表头')] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', attrs: { rowspan: 2 }, content: [para('合并行')] },
                { type: 'tableCell', content: [para('表格内容')] },
              ],
            },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [para('第三行')] }] },
          ],
        },
        { type: 'dataTable', attrs: { tableId: other } },
        { type: 'image', attrs: { src: 'https://example.com/image.png', alt: '原始图片' } },
        { type: 'video', attrs: { src: 'https://example.com/video.mp4' } },
      ],
    },
  })
  const endpoint = `/tables/${exportTable.id}/records/${exportRecord}/documents/${doc.id}/export`
  const response = await request(`${endpoint}?format=docx`)
  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get('Content-Type'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.ok(
    response.headers.get('Content-Disposition')!.includes(encodeURIComponent('企业研究 - 最新版')),
  )
  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()))
  const xml = strFromU8(archive['word/document.xml'])
  for (const text of [
    '最新正文',
    '&lt;重要结论&gt;',
    '第一项',
    '第二项',
    '确认完成',
    '合并表头',
    '第三行',
    '50 / 53',
  ])
    assert.ok(xml.includes(text), text)
  for (const text of [
    'PRIVATE_RECORD_PROPERTY',
    'SIBLING_DOCUMENT_SECRET',
    'SIBLING_BODY_SECRET',
    'OLD_BODY',
    '旧标题',
  ])
    assert.ok(!xml.includes(text), text)
  assert.match(xml, /<w:tbl>/)
  assert.match(xml, /<w:gridSpan w:val="2"/)
  assert.match(xml, /<w:vMerge w:val="restart"/)
  assert.match(xml, /<w:b\/>/)
  assert.match(xml, /<w:pStyle w:val="Heading2"/)
  assert.match(strFromU8(archive['word/numbering.xml']), /<w:start w:val="3"/)
  const relationships = strFromU8(archive['word/_rels/document.xml.rels'])
  for (const url of [
    'https://example.com/research',
    'https://example.com/image.png',
    'https://example.com/video.mp4',
  ])
    assert.ok(relationships.includes(url))
  const html = await (await request(endpoint)).text()
  assert.ok(html.includes('@page{size:A4'))
  assert.ok(html.includes('start="3"'))
  assert.ok(!html.includes('PRIVATE_RECORD_PROPERTY'))
  assert.equal((await request(`${endpoint}?format=exe`)).status, 400)
  assert.equal((await request(`${base}/${doc.id}/export?format=docx`)).status, 404)
})

test('videos support typed uploads and byte ranges; portable exports include videos and editable tables', async () => {
  const scope = { tableId: table, recordId: record }
  const doc = await docs.createDocument(scope, { title: '视频表格' })
  const bytes = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypmp42'),
    Buffer.alloc(24),
  ])
  const upload = await request(`${base}/${doc.id}/media`, 'POST', {
    data: bytes.toString('base64'),
  })
  assert.equal(upload.status, 201)
  const { src } = await upload.json()
  assert.ok(src.startsWith(`/api/projects/${project}/document-media/`))
  const range = await app.request(`http://localhost${src}`, { headers: { Range: 'bytes=4-7' } })
  assert.equal(range.status, 206)
  assert.equal(range.headers.get('Content-Range'), `bytes 4-7/${bytes.length}`)
  assert.equal(range.headers.get('Content-Type'), 'video/mp4')
  assert.equal(await range.text(), 'ftyp')
  assert.equal(
    (await app.request(`http://localhost${src}`, { headers: { Range: 'bytes=999-' } })).status,
    416,
  )
  assert.equal(
    (
      await request(`${base}/${doc.id}/media`, 'POST', {
        data: Buffer.from('<html>not video</html>').toString('base64'),
      })
    ).status,
    400,
  )
  await docs.updateDocument(scope, doc.id, {
    version: doc.version,
    content: {
      type: 'doc',
      content: [
        { type: 'video', attrs: { src } },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [para('公司')] },
                { type: 'tableCell', content: [para('iPollo')] },
              ],
            },
          ],
        },
      ],
    },
  })
  const html = await (await request(`${base}/${doc.id}/export`)).text()
  assert.ok(html.includes('<video controls'))
  assert.ok(html.includes('data:video/mp4;base64,'))
  assert.ok(html.includes('<th colspan="1" rowspan="1"><p>公司</p></th>'))
  await assert.rejects(() =>
    docs.createDocument(
      { tableId: foreign, recordId: foreignRecord },
      { title: '越界视频', content: { type: 'doc', content: [{ type: 'video', attrs: { src } }] } },
    ),
  )
})
