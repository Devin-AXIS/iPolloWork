import type { RelationGraph, GraphRecordSearch } from '../core/contracts'
import { transaction, identifier, isSqlite, type Connection } from './db'
import { DataError } from './errors'
import { requireExtension } from './extensions'

// Search names, not full records or external API values. The anchor table fixes database/project scope.
export async function searchGraphRecords(
  anchorId: string,
  input: { query: string; tableId?: string },
  access?: { allowedTables: ReadonlySet<string> },
): Promise<GraphRecordSearch> {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await db.query("SET LOCAL statement_timeout='3s'")
    if (!access) await requireExtension(db, 'relations')
    const root = (await db.query('SELECT project_id FROM iw_data.tables WHERE id=$1', [anchorId]))
      .rows[0]
    if (!root) throw new DataError('数据表不存在', 404)
    if (access && !access.allowedTables.has(anchorId))
      throw new DataError('数据表不在当前接入范围', 404)
    const choices: Array<{ id: string; name: string; fieldId: string }> = (
      await db.query(
        `SELECT t.id,t.name,f.id AS "fieldId" FROM iw_data.tables t
       JOIN iw_data.fields f ON f.table_id=t.id AND f.is_primary
       WHERE t.project_id=$1 AND ($3::uuid[] IS NULL OR t.id=ANY($3::uuid[]))
       AND ($4::uuid IS NULL OR t.id=$4)
       ORDER BY (t.id=$2) DESC,t.position,t.id LIMIT 65`,
        [
          root.project_id,
          anchorId,
          access ? [...access.allowedTables] : null,
          access ? (input.tableId ?? null) : null,
        ],
      )
    ).rows
    const tables = choices.slice(0, 64)
    if (input.tableId && !tables.some((t) => t.id === input.tableId))
      throw new DataError('数据表不在当前搜索范围内', 404)
    const query = input.query.trim()
    // Empty input suggests the current table; typed queries can search the project.
    const scope = tables.filter((t) =>
      input.tableId ? t.id === input.tableId : query || t.id === anchorId,
    )
    const values: unknown[] = [query.replace(/[\\%_]/g, '\\$&') + '%']
    const selects = scope.map((t) => {
      values.push(t.id, t.name)
      const base = values.length,
        title = `lower(${identifier(t.fieldId, 'f')}) COLLATE "C"`
      const select = `SELECT _record_id AS id,$${base - 1}::text AS "tableId",$${base}::text AS "tableName",
        left(${identifier(t.fieldId, 'f')},180) AS label
        FROM iw_data.${identifier(t.id)} WHERE ${title} LIKE lower($1) COLLATE "C" ESCAPE '\\'
        AND ${identifier(t.fieldId, 'f')}<>'' ORDER BY ${title},_record_id LIMIT 21`
      return isSqlite(db) ? `SELECT * FROM (${select})` : `(${select})`
    })
    const records: GraphRecordSearch['records'] = selects.length
      ? (
          await db.query(
            `SELECT * FROM (${selects.join(' UNION ALL ')}) found ORDER BY lower(label) COLLATE "C", "tableId",id LIMIT 21`,
            values,
          )
        ).rows
      : []
    return {
      records: records.slice(0, 20),
      tables: tables.map(({ id, name }) => ({ id, name })),
      hasMore: records.length > 20,
      tablesLimited: choices.length > 64,
    }
  })
}

// A bounded one-hop projection of committed rows and edges. No graph database or copied records.
export async function relationGraph(
  tableId: string,
  input: { page?: number; query?: string; recordId?: string; seedIds?: string[] } = {},
): Promise<RelationGraph> {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await requireExtension(db, 'relations')
    const root = (await db.query('SELECT project_id FROM iw_data.tables WHERE id=$1', [tableId]))
      .rows[0]
    if (!root) throw new DataError('数据表不存在', 404)
    const title = (
      await db.query('SELECT id FROM iw_data.fields WHERE table_id=$1 AND is_primary LIMIT 1', [
        tableId,
      ])
    ).rows[0]
    const parameters: unknown[] = [tableId]
    let filter = ''
    if (input.recordId) {
      parameters.push(input.recordId)
      filter += ` AND r.id=$${parameters.length}`
    }
    if (input.seedIds) {
      parameters.push(input.seedIds)
      filter += ` AND r.id=ANY($${parameters.length}::uuid[])`
    }
    if (input.query && title) {
      parameters.push(`${input.query.replace(/[\\%_]/g, '\\$&')}%`)
      filter += ` AND d.${identifier(title.id, 'f')} ILIKE $${parameters.length} ESCAPE '\\'`
    }
    parameters.push(input.seedIds || input.recordId ? 0 : ((input.page ?? 1) - 1) * 50)
    const seeds: Array<{ id: string }> = (
      await db.query(
        `SELECT r.id FROM iw_data.record_index r JOIN iw_data.${identifier(tableId)} d ON d._record_id=r.id WHERE r.table_id=$1 ${filter} ORDER BY r.created_at,r.id LIMIT 50 OFFSET $${parameters.length}`,
        parameters,
      )
    ).rows
    if (input.recordId && !seeds.length) throw new DataError('记录不存在', 404)
    const seedIds = new Set(seeds.map((r) => r.id))
    if (!seeds.length) return { tableId, nodes: [], edges: [], limited: false }
    const rows: Array<{
      relationId: string
      source: string
      target: string
      sourceTable: string
      targetTable: string
      label: string
      sourceField: RelationGraph['edges'][number]['sourceField']
      targetField: RelationGraph['edges'][number]['targetField']
    }> = (
      await db.query(
        `
      SELECT l.relation_id AS "relationId",l.source_id AS source,l.target_id AS target,
        d.source_table AS "sourceTable",d.target_table AS "targetTable",f.name AS label,
        jsonb_build_object('id',f.id,'name',f.name,'multiple',d.source_many) AS "sourceField",
        jsonb_build_object('id',g.id,'name',g.name,'multiple',d.target_many) AS "targetField"
      FROM iw_data.links l JOIN iw_data.relation_defs d ON d.id=l.relation_id
      JOIN iw_data.tables a ON a.id=d.source_table JOIN iw_data.tables b ON b.id=d.target_table
      JOIN iw_data.fields f ON f.relation_id=d.id AND f.side='source'
      JOIN iw_data.fields g ON g.relation_id=d.id AND g.side='target'
      WHERE (l.source_id=ANY($1::uuid[]) OR l.target_id=ANY($1::uuid[]))
        AND a.project_id=$2 AND b.project_id=$2
      ORDER BY l.relation_id,l.source_id,l.target_id LIMIT 401`,
        [[...seedIds], root.project_id],
      )
    ).rows
    const nodeTables = new Map(seeds.map((r) => [r.id, tableId]))
    const edges: RelationGraph['edges'] = []
    let limited = rows.length > 400
    for (const edge of rows.slice(0, 400)) {
      const missing = [edge.source, edge.target].filter((id) => !nodeTables.has(id))
      if (nodeTables.size + new Set(missing).size > 200) {
        limited = true
        continue
      }
      nodeTables.set(edge.source, edge.sourceTable)
      nodeTables.set(edge.target, edge.targetTable)
      edges.push({
        id: `${edge.relationId}:${edge.source}:${edge.target}`,
        relationId: edge.relationId,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        sourceField: edge.sourceField,
        targetField: edge.targetField,
      })
    }
    const nodes = await graphNodes(db, nodeTables, seedIds)
    return { tableId, nodes, edges, limited }
  })
}

// Hydrate bounded previews once per table, shared by legacy views and AI exploration.
export async function graphNodes(
  db: Connection,
  nodeTables: Map<string, string>,
  seedIds: Set<string>,
): Promise<RelationGraph['nodes']> {
  const tables: Array<{ id: string; name: string; fieldId: string }> = (
    await db.query(
      isSqlite(db) ? `SELECT t.id,t.name,(SELECT id FROM iw_data.fields WHERE table_id=t.id AND is_primary LIMIT 1) AS "fieldId" FROM iw_data.tables t WHERE t.id=ANY($1::uuid[]) ORDER BY t.id` : `SELECT t.id,t.name,f.id AS "fieldId" FROM iw_data.tables t LEFT JOIN LATERAL (
    SELECT id FROM iw_data.fields WHERE table_id=t.id AND is_primary LIMIT 1
  ) f ON true WHERE t.id=ANY($1::uuid[]) ORDER BY t.id`,
      [[...new Set(nodeTables.values())]],
    )
  ).rows
  // One bounded metadata read for all visible tables; no per-record reads, large bodies or API calls.
  const preview: Array<{
    id: string
    tableId: string
    name: string
    type: string
    api: boolean
  }> = (
    await db.query(
      `SELECT id,table_id AS "tableId",name,type,api FROM (
      SELECT id,table_id,name,type,(source IS NOT NULL) AS api,
        row_number() OVER (PARTITION BY table_id ORDER BY position,id) AS rank
      FROM iw_data.fields WHERE table_id=ANY($1::uuid[]) AND NOT is_primary
        AND type NOT IN ('relation','json','longtext','file','image')
    ) f WHERE rank<=4 ORDER BY table_id,rank`,
      [tables.map((t) => t.id)],
    )
  ).rows
  const values: unknown[] = []
  const selects = tables.map((t) => {
    values.push(
      [...nodeTables].filter(([, id]) => id === t.id).map(([id]) => id),
      t.id,
      t.name,
    )
    const base = values.length
    const columns = preview
      .filter((f) => f.tableId === t.id)
      .map((f) => `'${f.id}',left(${isSqlite(db) && f.type === 'boolean' ? `CASE WHEN d.${identifier(f.id, 'f')} IS NULL THEN NULL WHEN d.${identifier(f.id, 'f')} THEN 'true' ELSE 'false' END` : `d.${identifier(f.id, 'f')}::text`},140)`)
    return `SELECT d._record_id AS id,$${base - 1}::text AS "tableId",$${base}::text AS "tableName",${t.fieldId ? `coalesce(nullif(left(d.${identifier(t.fieldId, 'f')},180),''),'未命名')` : "'未命名'"} AS label,
      jsonb_build_object(${columns.join(',')}) AS preview
      FROM iw_data.${identifier(t.id)} d WHERE d._record_id=ANY($${base - 2}::uuid[])`
  })
  const nodes = (await db.query(selects.join(' UNION ALL '), values)).rows.map(
    ({ preview: record, ...n }) => ({
      ...n,
      root: seedIds.has(n.id),
      fields: preview
        .filter((f) => f.tableId === n.tableId)
        .map(({ tableId: _table, ...f }) => ({ ...f, value: record[f.id] })),
    }),
  )
  return nodes
}
