import { exploreRelations } from './exploration'
import * as documents from './documents'
import { uploadDocumentImage, uploadDocumentVideo, documentImage } from './document-files'
import { exportDocument } from './document-export'
import { createResearchExample } from './research-example'
import { sourceDefinitions, fieldSourceInput } from '../core/sources'
import { apiOrigins } from './api-fetch'
import { resolveDynamicValues } from './providers'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { pool } from './db'
import * as store from './store'
import { fieldTypes } from '../core/fields'
import { createExample } from './example'
import { getExtensions, changeExtension } from './extensions'
import { availableContribution } from '../core/extensions'
import { blueprintInput } from '../core/blueprint'
import { applyBlueprint } from './blueprint'
import { commandInput, executeCommand } from './commands'
import { createRule, rulesFor, changeRule, deleteRule } from './automation'
import { importRecords } from './import'
import * as databases from './databases'
import { integration, integrationInfo, integrationOpenApi } from './integration'
import { handleMcp } from './mcp'
import { pluginAsset } from './plugin-packages'
import { relationGraph, searchGraphRecords } from './relations'
import { importPlugin, previewPluginImport } from './plugin-import'
import { listRecords, recordListInput } from './list-records'
import { recordQueryInput } from '../core/query'
import { projectChanges } from './live-data'
import { updateField, previewFieldDelete, deleteField } from './field-management'

export const app = new Hono()
app.use('/api/*', (c, next) =>
  bodyLimit({
    maxSize: /\/documents\/[^/]+\/media$/.test(c.req.path)
      ? 33_500_000
      : /\/documents\/[^/]+\/images$/.test(c.req.path)
        ? 7_100_000
        : /^\/api\/extensions\/import(?:\/preview)?$/.test(c.req.path)
          ? 7_000_000
          : 1_000_000,
  })(c, next),
)
app.use('/api/*', async (c, next) => {
  if (!['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname))
    return c.json({ error: '仅允许本机访问' }, 403)
  const origin = c.req.header('Origin')
  if (
    origin &&
    ![
      'http://127.0.0.1:5710',
      'http://localhost:5710',
      'http://127.0.0.1:5711',
      'http://localhost:5711',
      `http://127.0.0.1:${process.env.PORT ?? 5711}`,
      `http://localhost:${process.env.PORT ?? 5711}`,
    ].includes(origin)
  )
    return c.json({ error: '来源未被允许' }, 403)
  if (
    ['POST', 'PATCH', 'DELETE'].includes(c.req.method) &&
    !(c.req.method === 'DELETE' && c.req.path.endsWith('/mcp'))
  ) {
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ error: '请使用 JSON 请求' }, 415)
  }
  await next()
})
app.onError((error, c) => {
  if ('code' in error && error.code === '57014')
    return c.json({ error: '查询超时，请缩小筛选范围后重试' }, 400)
  if (error instanceof SyntaxError) return c.json({ error: 'JSON 格式不正确' }, 400)
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: error.issues[0]?.message ?? '请求格式错误',
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    )
  if (error instanceof store.DataError) {
    if (error.status === 404) return c.json({ error: error.message }, 404)
    if (error.status === 409) return c.json({ error: error.message }, 409)
    return c.json({ error: error.message }, 400)
  }
  if ('code' in error && error.code === '23505')
    return c.json({ error: '名称重复，或该记录已达到关联数量限制。请检查后重试。' }, 409)
  if ('code' in error && error.code === '23503')
    return c.json({ error: '引用的项目、表或记录已不存在' }, 409)
  console.error(error)
  return c.json({ error: '操作未完成，请稍后重试' }, 500)
})
const id = (value: string | undefined) => z.uuid().parse(value)
// Resolve storage once per request; every nested store operation keeps this scope.
app.use('/api/*', async (c, next) => {
  const table = c.req.path.match(/^\/api\/tables\/([^/]+)(?:\/|$)/)
  if (table) return databases.withTable(id(table[1]), next)
  const project = c.req.path.match(
    /^\/api\/projects\/([^/]+)\/(?:tables(?:\/order)?|schema|documents|document-(?:images|media)\/[^/]+)$/,
  )
  if (project) return databases.withProject(id(project[1]), next)
  if (
    /^\/api\/(?:extensions(?:\/(?:[^/]+|import\/preview))?|field-types|capabilities)$/.test(
      c.req.path,
    ) &&
    c.req.query('projectId')
  )
    return databases.withProject(id(c.req.query('projectId')!), next)
  await next()
})
app.post('/api/databases/test', async (c) =>
  c.json(await databases.testConnection(await c.req.json())),
)
app.get('/api/projects/:id/database', async (c) =>
  c.json(await databases.projectDatabase(id(c.req.param('id')))),
)
app.get('/api/projects/:id/changes', async (c) => {
  const projectId = id(c.req.param('id'))
  const exists = await databases.withProject(
    projectId,
    async () =>
      (await pool.query('SELECT id FROM iw_data.projects WHERE id=$1', [projectId])).rowCount,
  )
  if (!exists) return c.json({ error: '项目不存在' }, 404)
  return projectChanges(
    c,
    projectId,
    c.req.query('workbenchId') ? id(c.req.query('workbenchId')!) : undefined,
  )
})
app.post('/api/projects/:id/database/test', async (c) =>
  c.json(await databases.testProjectDatabase(id(c.req.param('id')))),
)
app.patch('/api/projects/:id', async (c) =>
  c.json(await databases.updateProject(id(c.req.param('id')), await c.req.json())),
)
app.get('/api/field-providers', (c) =>
  c.json({
    providers: sourceDefinitions,
    schema: z.toJSONSchema(fieldSourceInput),
    allowedOrigins: apiOrigins(),
  }),
)
app.get('/api/health', async (c) => {
  const result = await pool.query('SELECT version() AS version')
  return c.json({ ok: true, service: 'ipollo-onto', scope: process.env.ONTO_DATA_SCOPE ?? null, database: result.rows[0].version, mode: 'local-single-instance' })
})
app.get('/api/field-types', async (c) => {
  const extensions = await getExtensions()
  return c.json(
    fieldTypes
      .list()
      .filter((f) => availableContribution(extensions, 'fields', f.id))
      .map(({ validateOptions: _options, validate: _v, format: _f, ...rest }) => rest),
  )
})
app.get('/api/extensions', async (c) => c.json(await getExtensions()))
app.post('/api/extensions/import/preview', async (c) =>
  c.json(await previewPluginImport(await c.req.json())),
)
app.post('/api/extensions/import', async (c) => c.json(await importPlugin(await c.req.json())))
app.get('/api/extensions/:id/assets/:file', (c) => {
  const asset = pluginAsset(c.req.param('id'), c.req.param('file'), c.req.query('v'))
  c.header('Content-Type', asset.mime)
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(new Uint8Array(asset.bytes).buffer)
})
app.post('/api/extensions/:id', async (c) => {
  const { action } = z
    .object({ action: z.enum(['install', 'enable', 'disable', 'uninstall', 'upgrade']) })
    .strict()
    .parse(await c.req.json())
  return c.json(await changeExtension(c.req.param('id'), action))
})
app.get('/api/capabilities', async (c) =>
  c.json({
    protocolVersion: 1,
    aiProvider: 'iPolloWork',
    mode: 'local-single-instance',
    commandEndpoint: '/api/commands',
    commandSchema: z.toJSONSchema(commandInput),
    blueprintSchema: z.toJSONSchema(blueprintInput),
    fieldSourceSchema: z.toJSONSchema(fieldSourceInput),
    providers: sourceDefinitions,
    apiAllowedOrigins: apiOrigins(),
    extensions: await getExtensions(),
    rules: [
      '新表第一个字段为文本标题',
      '结构构建只新增，不隐式覆盖或删除已有表',
      '关联已有表使用 UUID 与 targetVersion；直接关联限于同一物理数据库',
      'project.create 可选择默认或独立数据库；已有项目不原地切换数据库',
      'extensions 与 field-types 可通过 projectId 查询项目所在数据库的扩展',
      'schema.preview 不持久保存，返回的临时 ID 不能用于后续写入',
      'schema.apply 与 records.import 使用 requestId 保证项目存续期间幂等；同标识不同内容拒绝',
      '更新记录必须携带当前 version',
      'API 字段只读；source.storage=live 不落库，snapshot 在获取成功后保存最新值与来源时间',
      'API 读取有短缓存；fresh 表示缓存有效，不保证行情源为交易所实时数据',
      'AI 模型与宿主桥接由 iPolloWork 提供，当前没有模型连接',
    ],
  }),
)
app.post('/api/commands', async (c) => c.json(await executeCommand(await c.req.json())))
for (const kind of ['project', 'table'] as const) {
  const base = `/api/${kind}s/:id`
  app.get(`${base}/integration`, async (c) =>
    c.json(await integrationInfo({ kind, id: id(c.req.param('id')) })),
  )
  app.get(`${base}/context`, async (c) =>
    c.json((await integration({ kind, id: id(c.req.param('id')) })).context),
  )
  app.get(`${base}/openapi.json`, async (c) =>
    c.json(await integrationOpenApi({ kind, id: id(c.req.param('id')) })),
  )
  app.post(`${base}/operations/:operation`, async (c) => {
    const service = await integration({ kind, id: id(c.req.param('id')) })
    return c.json(await service.execute(c.req.param('operation'), await c.req.json()))
  })
  app.all(`${base}/mcp`, (c) => handleMcp({ kind, id: id(c.req.param('id')) }, c.req.raw))
}
app.post('/api/blueprints/preview', async (c) =>
  c.json(await applyBlueprint(await c.req.json(), true)),
)
app.post('/api/blueprints/apply', async (c) => c.json(await applyBlueprint(await c.req.json())))
app.post('/api/tables/:id/import', async (c) =>
  c.json(await importRecords(id(c.req.param('id')), await c.req.json())),
)
app.get('/api/tables/:id/automations', async (c) => c.json(await rulesFor(id(c.req.param('id')))))
app.post('/api/tables/:id/automations', async (c) =>
  c.json(await createRule(id(c.req.param('id')), await c.req.json()), 201),
)
app.patch('/api/tables/:id/automations/:ruleId', async (c) => {
  const { enabled } = z
    .object({ enabled: z.boolean() })
    .strict()
    .parse(await c.req.json())
  return c.json(await changeRule(id(c.req.param('id')), id(c.req.param('ruleId')), enabled))
})
app.delete('/api/tables/:id/automations/:ruleId', async (c) =>
  c.json(await deleteRule(id(c.req.param('id')), id(c.req.param('ruleId')))),
)
app.get('/api/projects', async (c) => c.json(await databases.listProjects()))
app.post('/api/examples/research', async (c) => c.json(await createResearchExample(), 201))
app.post('/api/examples', async (c) => c.json(await createExample(), 201))
app.post('/api/projects', async (c) =>
  c.json(await databases.createManagedProject(await c.req.json()), 201),
)
app.delete('/api/projects/:id', async (c) => {
  await databases.deleteManagedProject(id(c.req.param('id')))
  return c.json({ ok: true })
})
app.get('/api/tables', async (c) =>
  c.json(
    await databases.listTables(
      c.req.query('projectId') ? id(c.req.query('projectId')!) : undefined,
    ),
  ),
)
app.post('/api/projects/:id/tables', async (c) =>
  c.json(
    await store.createTable(id(c.req.param('id')), store.tableInput.parse(await c.req.json())),
    201,
  ),
)
app.get('/api/projects/:id/schema', async (c) =>
  c.json(await store.getSchema(id(c.req.param('id')))),
)
app.patch('/api/tables/:id', async (c) =>
  c.json(
    await store.renameTable(
      id(c.req.param('id')),
      store.tableUpdateInput.parse(await c.req.json()),
    ),
  ),
)
app.patch('/api/projects/:id/tables/order', async (c) =>
  c.json(
    await store.reorderTables(
      id(c.req.param('id')),
      store.tableOrderInput.parse(await c.req.json()),
    ),
  ),
)
app.patch('/api/tables/:id/fields/order', async (c) =>
  c.json(
    await store.reorderFields(
      id(c.req.param('id')),
      store.fieldOrderInput.parse(await c.req.json()),
    ),
  ),
)
app.patch('/api/tables/:id/detail-layout', async (c) =>
  c.json(
    await store.saveDetailLayout(
      id(c.req.param('id')),
      store.detailLayoutInput.parse(await c.req.json()),
    ),
  ),
)
app.get('/api/tables/:id/records/:recordId/relations/:fieldId', async (c) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(c.req.query('page') ?? 1)
  const data = await store.getRelatedData(
    id(c.req.param('id')),
    id(c.req.param('recordId')),
    id(c.req.param('fieldId')),
    page,
  )
  return c.json(await resolveDynamicValues(data))
})
app.delete('/api/tables/:id', async (c) => {
  await store.deleteTable(id(c.req.param('id')))
  return c.json({ ok: true })
})
app.post('/api/tables/:id/fields', async (c) =>
  c.json(
    await store.createField(id(c.req.param('id')), store.fieldInput.parse(await c.req.json())),
    201,
  ),
)
app.patch('/api/tables/:id/fields/:fieldId', async (c) =>
  c.json(await updateField(id(c.req.param('id')), id(c.req.param('fieldId')), await c.req.json())),
)
app.get('/api/tables/:id/fields/:fieldId/delete-preview', async (c) =>
  c.json(await previewFieldDelete(id(c.req.param('id')), id(c.req.param('fieldId')))),
)
app.delete('/api/tables/:id/fields/:fieldId', async (c) =>
  c.json(await deleteField(id(c.req.param('id')), id(c.req.param('fieldId')), await c.req.json())),
)
app.post('/api/tables/:id/graph/explore', async (c) =>
  c.json(await exploreRelations(id(c.req.param('id')), await c.req.json())),
)
app.get('/api/tables/:id/graph/records', async (c) => {
  const input = z.object({ query: z.string().trim().max(80), tableId: z.uuid().optional() }).parse({
    query: c.req.query('q') ?? '',
    tableId: c.req.query('tableId'),
  })
  return c.json(await searchGraphRecords(id(c.req.param('id')), input))
})
app.get('/api/tables/:id/graph', async (c) => {
  const input = z
    .object({
      page: z.coerce.number().int().min(1).max(100000).optional(),
      query: z.string().max(80).optional(),
      recordId: z.uuid().optional(),
      seedIds: z.array(z.uuid()).max(50).optional(),
    })
    .parse({
      page: c.req.query('page'),
      query: c.req.query('q'),
      recordId: c.req.query('recordId'),
      seedIds: c.req.query('seedIds')?.split(',').filter(Boolean),
    })
  return c.json(await relationGraph(id(c.req.param('id')), input))
})
app.get('/api/tables/:id/records', async (c) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .parse(c.req.query('page') ?? 1)
  const q = z
    .string()
    .max(80)
    .parse(c.req.query('q') ?? '')
  const mode = z.enum(['defer', 'resolve']).parse(c.req.query('dynamic') ?? 'resolve')
  const refresh = z.enum(['0', '1']).parse(c.req.query('refresh') ?? '0') === '1'
  const recordId = z.uuid().optional().parse(c.req.query('recordId'))
  if (recordId) {
    if (c.req.query('selection') || c.req.query('viewId'))
      return c.json({ error: '单条记录读取不能同时指定筛选或保存视图' }, 400)
    const data = await store.getData(id(c.req.param('id')), page, q, recordId)
    return c.json(mode === 'defer' ? data : await resolveDynamicValues(data, refresh))
  }
  const selection = c.req.query('selection')
  return c.json(
    await listRecords(
      id(c.req.param('id')),
      {
        page,
        query: q,
        selection: selection ? recordQueryInput.parse(JSON.parse(selection)) : undefined,
        viewId: c.req.query('viewId'),
      },
      mode === 'defer' ? 'saved' : refresh ? 'refresh' : 'resolve',
    ),
  )
})
app.post('/api/tables/:id/query', async (c) =>
  c.json(await listRecords(id(c.req.param('id')), recordListInput.parse(await c.req.json()))),
)
app.get('/api/tables/:id/query-context', async (c) =>
  c.json(await store.getQueryContext(id(c.req.param('id')))),
)
app.post('/api/tables/:id/views', async (c) =>
  c.json(await store.saveQueryView(id(c.req.param('id')), await c.req.json())),
)
app.delete('/api/tables/:id/views/:viewId', async (c) => {
  const input = z
    .object({ version: z.number().int().positive() })
    .strict()
    .parse(await c.req.json())
  return c.json(
    await store.deleteQueryView(id(c.req.param('id')), id(c.req.param('viewId')), input.version),
  )
})
app.get('/api/tables/:id/options', async (c) =>
  c.json(
    await store.getOptions(
      id(c.req.param('id')),
      z
        .string()
        .max(80)
        .parse(c.req.query('q') ?? ''),
    ),
  ),
)
app.post('/api/tables/:id/records', async (c) =>
  c.json(
    {
      id: await store.saveRecord(
        id(c.req.param('id')),
        store.recordInput.parse(await c.req.json()),
      ),
    },
    201,
  ),
)
app.patch('/api/tables/:id/records/:recordId', async (c) =>
  c.json({
    id: await store.saveRecord(
      id(c.req.param('id')),
      store.recordInput.parse(await c.req.json()),
      id(c.req.param('recordId')),
    ),
  }),
)
app.delete('/api/tables/:id/records/:recordId', async (c) => {
  const { version } = z.object({ version: z.number().int().positive() }).parse(await c.req.json())
  await store.deleteRecord(id(c.req.param('id')), id(c.req.param('recordId')), version)
  return c.json({ ok: true })
})
app.notFound((c) => c.json({ error: '接口不存在' }, 404))

app.get('/api/projects/:id/documents', async (c) =>
  c.json(
    await documents.projectDocuments(
      id(c.req.param('id')),
      z
        .string()
        .max(80)
        .parse(c.req.query('q') ?? ''),
      z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(c.req.query('page') ?? 1),
    ),
  ),
)
app.get('/api/projects/:id/document-images/:file', async (c) => {
  const image = await documentImage(id(c.req.param('id')), c.req.param('file'))
  c.header('Content-Type', image.mime)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'private, max-age=86400')
  return c.body(new Uint8Array(image.bytes).buffer)
})
app.get('/api/projects/:id/document-media/:file', async (c) => {
  const media = await documentImage(id(c.req.param('id')), c.req.param('file'))
  c.header('Content-Type', media.mime)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'private, max-age=86400')
  c.header('Accept-Ranges', 'bytes')
  const range = c.req.header('Range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    const length = media.bytes.length
    const start = match?.[1] ? Number(match[1]) : Math.max(0, length - Number(match?.[2] ?? 0))
    const end = match?.[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1
    if (!match || start > end || start >= length) {
      c.header('Content-Range', `bytes */${length}`)
      return c.body(null, 416)
    }
    c.header('Content-Range', `bytes ${start}-${end}/${length}`)
    return c.body(new Uint8Array(media.bytes.subarray(start, end + 1)).buffer, 206)
  }
  return c.body(new Uint8Array(media.bytes).buffer)
})
const docBase = '/api/tables/:id/records/:recordId/documents'
app.get(docBase, async (c) =>
  c.json(
    await documents.listDocuments({
      tableId: id(c.req.param('id')),
      recordId: id(c.req.param('recordId')),
    }),
  ),
)
app.post(docBase, async (c) =>
  c.json(
    await documents.createDocument(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      await c.req.json(),
    ),
    201,
  ),
)
app.post(`${docBase}/table`, async (c) => {
  const { config, page, interactive } = z
    .object({
      config: z.unknown(),
      page: z.number().int().min(1).max(100000).default(1),
      interactive: z.boolean().default(false),
    })
    .strict()
    .parse(await c.req.json())
  return c.json(
    await documents.documentTable(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      config,
      page,
      undefined,
      interactive,
    ),
  )
})
app.get(`${docBase}/:documentId`, async (c) =>
  c.json(
    await documents.getDocument(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      id(c.req.param('documentId')),
    ),
  ),
)
app.patch(`${docBase}/:documentId`, async (c) =>
  c.json(
    await documents.updateDocument(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      id(c.req.param('documentId')),
      await c.req.json(),
    ),
  ),
)
app.post(`${docBase}/:documentId/link`, async (c) =>
  c.json(
    await documents.attachDocument(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      id(c.req.param('documentId')),
    ),
  ),
)
app.delete(`${docBase}/:documentId/link`, async (c) =>
  c.json(
    await documents.detachDocument(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      id(c.req.param('documentId')),
    ),
  ),
)
app.post(`${docBase}/:documentId/images`, async (c) =>
  c.json(
    await uploadDocumentImage(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      id(c.req.param('documentId')),
      await c.req.json(),
    ),
    201,
  ),
)
app.post(`${docBase}/:documentId/media`, async (c) =>
  c.json(
    await uploadDocumentVideo(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      id(c.req.param('documentId')),
      await c.req.json(),
    ),
    201,
  ),
)
app.get(`${docBase}/:documentId/export`, async (c) => {
  const format = z.enum(['html', 'docx']).parse(c.req.query('format') ?? 'html')
  const scope = { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) }
  const documentId = id(c.req.param('documentId'))
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'no-store')
  if (format === 'docx') {
    const { exportWordDocument } = await import('./document-word')
    const result = await exportWordDocument(scope, documentId)
    c.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    c.header(
      'Content-Disposition',
      `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(result.title.replace(/[\\/:*?"<>|\r\n]/g, '-'))}.docx`,
    )
    return c.body(new Uint8Array(result.bytes))
  }
  const result = await exportDocument(scope, documentId)
  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header(
    'Content-Disposition',
    `attachment; filename="document.html"; filename*=UTF-8''${encodeURIComponent(result.title.replace(/[\\/:*?"<>|\r\n]/g, '-'))}.html`,
  )
  c.header('X-Content-Type-Options', 'nosniff')
  return c.body(result.html)
})

app.get(`${docBase}/:documentId/version`, async (c) =>
  c.json(
    await documents.documentVersion(
      { tableId: id(c.req.param('id')), recordId: id(c.req.param('recordId')) },
      id(c.req.param('documentId')),
    ),
  ),
)
