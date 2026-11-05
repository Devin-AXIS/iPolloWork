import { randomUUID, createHash } from 'node:crypto'
import { pool, transaction, lockFieldReferences, type Connection } from './db'
import { compileQuery } from './query'
import { DataError } from './errors'
import * as store from './store'
import { listRecords } from './list-records'
import {
  documentValueEqual,
  documentCreateInput,
  documentUpdateInput,
  documentContentInput,
  applyDocumentOperations,
  visitDocument,
  embedInput,
  type DocumentContent,
  type DocumentSummary,
  type RecordDocument,
} from '../core/documents'

export interface DocumentScope {
  tableId: string
  recordId: string
}
const summaryColumns = `d.id,d.project_id AS "projectId",d.title,d.version,d.created_at AS "createdAt",d.updated_at AS "updatedAt",
 (SELECT count(*)::int FROM iw_data.document_records b WHERE b.document_id=d.id) AS "linkedRecords"`
async function recordProject(scope: DocumentScope, db = pool as Pick<Connection, 'query'>) {
  const row = (
    await db.query(
      `SELECT t.project_id FROM iw_data.record_index r JOIN iw_data.tables t ON t.id=r.table_id WHERE r.id=$1 AND r.table_id=$2`,
      [scope.recordId, scope.tableId],
    )
  ).rows[0]
  if (!row) throw new DataError('记录不存在', 404)
  return row.project_id as string
}
export async function listDocuments(scope: DocumentScope): Promise<DocumentSummary[]> {
  await recordProject(scope)
  return (
    await pool.query(
      `SELECT ${summaryColumns} FROM iw_data.document_records b JOIN iw_data.documents d ON d.id=b.document_id WHERE b.record_id=$1 ORDER BY b.created_at,d.id LIMIT 100`,
      [scope.recordId],
    )
  ).rows
}
export async function projectDocuments(
  projectId: string,
  search = '',
  page = 1,
): Promise<DocumentSummary[]> {
  return (
    await pool.query(
      `SELECT ${summaryColumns} FROM iw_data.documents d WHERE d.project_id=$1 AND d.title ILIKE $2 ESCAPE '\\' ORDER BY d.created_at DESC,d.id LIMIT 50 OFFSET $3`,
      [projectId, `${search.replace(/[\\%_]/g, '\\$&')}%`, (page - 1) * 50],
    )
  ).rows
}
export async function getDocument(
  scope: DocumentScope,
  documentId: string,
  db = pool as Pick<Connection, 'query'>,
): Promise<RecordDocument> {
  await recordProject(scope, db)
  const doc = (
    await db.query(
      `SELECT ${summaryColumns},d.content,d.schema_version AS "schemaVersion" FROM iw_data.documents d JOIN iw_data.document_records b ON b.document_id=d.id WHERE d.id=$1 AND b.record_id=$2`,
      [documentId, scope.recordId],
    )
  ).rows[0]
  if (!doc) throw new DataError('文档不在当前记录中', 404)
  return doc
}
function normalize(content: DocumentContent) {
  const next = structuredClone(content)
  visitDocument(next, (n) => {
    if (n.type !== 'text' && n.type !== 'hardBreak')
      n.attrs = { ...n.attrs, id: n.attrs?.id ?? randomUUID() }
  })
  return documentContentInput.parse(next)
}
async function validateReferences(
  projectId: string,
  content: DocumentContent,
  db: Connection,
  allowed?: Set<string>,
) {
  const references: string[] = []
  let foreignImage = false
  visitDocument(content, (n) => {
    if (n.type === 'dataTable') references.push(String(n.attrs?.tableId))
    if (
      ['image', 'video'].includes(n.type) &&
      String(n.attrs?.src).startsWith('/api/projects/') &&
      !['images', 'media'].some((kind) =>
        String(n.attrs?.src).startsWith(`/api/projects/${projectId}/document-${kind}/`),
      )
    )
      foreignImage = true
  })
  if (foreignImage) throw new DataError('图片不在当前项目中')
  const tables = [...new Set(references)]
  if (tables.length > 12 || references.length > 12) throw new DataError('每篇文档最多引用 12 张表')
  if (allowed && tables.some((id) => !allowed.has(id)))
    throw new DataError('引用表不在当前接入范围', 404)
  if (tables.length) {
    const rows = await db.query(
      'SELECT id FROM iw_data.tables WHERE id=ANY($1::uuid[]) AND project_id=$2',
      [tables, projectId],
    )
    if (rows.rowCount !== tables.length) throw new DataError('文档只能引用当前项目的表')
    const embeds: Array<ReturnType<typeof embedInput.parse>> = []
    visitDocument(content, (n) => {
      if (n.type === 'dataTable') {
        const { id: _id, ...config } = n.attrs ?? {}
        embeds.push(embedInput.parse(config))
      }
    })
    for (const embed of embeds) {
      const fields = await store.fieldsFor(db, embed.tableId)
      if (
        embed.relationFieldId &&
        !fields.some((f) => f.id === embed.relationFieldId && f.relationId)
      )
        throw new DataError('文档引用的关联字段已不存在，请调整引用', 409)
      if (embed.selection)
        await compileQuery(db, fields, embed.selection, [], store.fieldsFor, allowed)
    }
  }
}
export async function createDocument(scope: DocumentScope, raw: unknown, allowed?: Set<string>) {
  const input = documentCreateInput.parse(raw)
  const documentId = input.id ?? randomUUID()
  const hash = createHash('sha256')
    .update(JSON.stringify({ title: input.title, content: input.content }))
    .digest('hex')
  await transaction(async (db) => {
    await lockFieldReferences(db)
    const projectId = await recordProject(scope, db)
    // Serialize the per-record limit and client-ID retry check.
    await db.query('SELECT id FROM iw_data.record_index WHERE id=$1 FOR UPDATE', [scope.recordId])
    const existing = await db.query('SELECT id,creation_hash FROM iw_data.documents WHERE id=$1', [
      documentId,
    ])
    if (existing.rowCount) {
      // A supplied ID may only recover its own already-linked create, never attach another document.
      await getDocument(scope, documentId, db)
      if (existing.rows[0].creation_hash !== hash)
        throw new DataError('该创建标识已被使用，请使用新的文档 ID', 409)
      return
    }
    const count = (
      await db.query('SELECT count(*)::int AS n FROM iw_data.document_records WHERE record_id=$1', [
        scope.recordId,
      ])
    ).rows[0].n
    if (count >= 100) throw new DataError('每条记录最多关联 100 篇文档')
    const content = normalize(input.content)
    await validateReferences(projectId, content, db, allowed)
    await db.query(
      'INSERT INTO iw_data.documents(id,project_id,title,content,creation_hash) VALUES($1,$2,$3,$4,$5)',
      [documentId, projectId, input.title, JSON.stringify(content), hash],
    )
    await db.query('INSERT INTO iw_data.document_records(document_id,record_id) VALUES($1,$2)', [
      documentId,
      scope.recordId,
    ])
  })
  return getDocument(scope, documentId)
}
export async function updateDocument(
  scope: DocumentScope,
  documentId: string,
  raw: unknown,
  allowed?: Set<string>,
) {
  const input = documentUpdateInput.parse(raw)
  return transaction(async (db) => {
    await lockFieldReferences(db)
    await db.query('SELECT id FROM iw_data.documents WHERE id=$1 FOR UPDATE', [documentId])
    const current = await getDocument(scope, documentId, db)
    if (current.version !== input.version)
      throw new DataError('文档已有新版本，你的草稿已保留。请查看最新内容后再保存。', 409)
    let content = input.content ?? current.content
    if (input.operations) {
      try {
        content = applyDocumentOperations(content, input.operations)
      } catch (e) {
        throw new DataError(e instanceof Error ? e.message : '内容块操作失败', 409)
      }
    }
    content = normalize(content)
    await validateReferences(current.projectId, content, db, allowed)
    const title = input.title ?? current.title
    if (documentValueEqual(content, current.content) && title === current.title) return current
    await db.query(
      'UPDATE iw_data.documents SET title=$2,content=$3,version=version+1,updated_at=now() WHERE id=$1',
      [documentId, title, JSON.stringify(content)],
    )
    return getDocument(scope, documentId, db)
  })
}
export async function attachDocument(
  scope: DocumentScope,
  documentId: string,
  allowed?: Set<string>,
) {
  await transaction(async (db) => {
    const projectId = await recordProject(scope, db)
    await db.query('SELECT id FROM iw_data.record_index WHERE id=$1 FOR UPDATE', [scope.recordId])
    const doc = (
      await db.query('SELECT project_id FROM iw_data.documents WHERE id=$1 FOR UPDATE', [
        documentId,
      ])
    ).rows[0]
    if (!doc || doc.project_id !== projectId) throw new DataError('文档不在当前项目中', 404)
    if (allowed) {
      const visible = await db.query(
        'SELECT 1 FROM iw_data.document_records b JOIN iw_data.record_index r ON r.id=b.record_id WHERE b.document_id=$1 AND r.table_id=ANY($2::uuid[]) LIMIT 1',
        [documentId, [...allowed]],
      )
      if (!visible.rowCount) throw new DataError('文档不在当前接入范围', 404)
    }
    if (
      (
        await db.query(
          'SELECT 1 FROM iw_data.document_records WHERE document_id=$1 AND record_id=$2',
          [documentId, scope.recordId],
        )
      ).rowCount
    )
      return
    const count = (
      await db.query('SELECT count(*)::int AS n FROM iw_data.document_records WHERE record_id=$1', [
        scope.recordId,
      ])
    ).rows[0].n
    if (count >= 100) throw new DataError('每条记录最多关联 100 篇文档')
    await db.query(
      'INSERT INTO iw_data.document_records(document_id,record_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [documentId, scope.recordId],
    )
  })
  return getDocument(scope, documentId)
}
export async function detachDocument(scope: DocumentScope, documentId: string) {
  await transaction(async (db) => {
    await getDocument(scope, documentId, db)
    await db.query('DELETE FROM iw_data.document_records WHERE document_id=$1 AND record_id=$2', [
      documentId,
      scope.recordId,
    ])
  })
  return { ok: true }
}
export async function documentTable(
  scope: DocumentScope,
  raw: unknown,
  page = 1,
  allowed?: Set<string>,
  interactive = false,
) {
  const config = embedInput.parse(raw)
  const projectId = await recordProject(scope)
  const target = await store.getTableSchema(config.tableId)
  if (target.projectId !== projectId || (allowed && !allowed.has(config.tableId)))
    throw new DataError('引用表不在当前接入范围', 404)
  const tableIds = new Set<string>(
    (await pool.query('SELECT id FROM iw_data.tables WHERE project_id=$1', [projectId])).rows.map(
      (r) => r.id,
    ),
  )
  const permitted = allowed ?? tableIds
  let data
  if (config.relationFieldId) {
    const field = target.fields.find((f) => f.id === config.relationFieldId)
    if (!field?.targetTableId || !permitted.has(field.targetTableId))
      throw new DataError('关联表不在当前接入范围', 404)
    data = await store.getRelatedData(
      config.tableId,
      config.recordId!,
      config.relationFieldId,
      page,
    )
  } else if (config.recordId) {
    data = await store.getData(config.tableId, 1, '', config.recordId, undefined, permitted)
  } else
    data = await listRecords(
      config.tableId,
      { page, selection: config.selection, viewId: config.viewId },
      'saved',
      permitted,
    )
  // The editor uses the real grid. Exports and AI reads keep their bounded projection.
  // Both paths reuse SQL pagination and never initiate remote API calls.
  if (interactive) {
    const source = target.fields.find((f) => f.id === config.relationFieldId)
    const inverse =
      source &&
      data.fields.find((f) => f.relationId === source.relationId && f.side !== source.side)
    return {
      ...data,
      createValues: inverse ? { [inverse.id]: [config.recordId!] } : {},
    }
  }
  const fields = data.fields
    .filter((f) => f.type !== 'relation' && f.type !== 'json' && f.type !== 'longtext')
    .slice(0, 6)
  return {
    ...data,
    fields,
    records: data.records.map((r) => ({
      ...r,
      values: Object.fromEntries(fields.map((f) => [f.id, r.values[f.id]])),
      dynamic: Object.fromEntries(
        fields.flatMap((f) => (r.dynamic?.[f.id] ? [[f.id, r.dynamic[f.id]]] : [])),
      ),
    })),
  }
}

export async function documentVersion(scope: DocumentScope, documentId: string) {
  const row = (
    await pool.query(
      `SELECT d.version FROM iw_data.documents d JOIN iw_data.document_records b ON b.document_id=d.id JOIN iw_data.record_index r ON r.id=b.record_id WHERE d.id=$1 AND r.id=$2 AND r.table_id=$3`,
      [documentId, scope.recordId, scope.tableId],
    )
  ).rows[0]
  if (!row) throw new DataError('文档不在当前记录中', 404)
  return { version: Number(row.version) }
}
