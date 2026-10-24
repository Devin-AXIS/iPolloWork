import type { RelationGraph } from '../core/contracts'
import { explorationInput, explorationHref, type GraphExploration } from '../core/exploration'
import { transaction, isSqlite } from './db'
import { DataError } from './errors'
import { graphNodes } from './relations'

type Relation = {
  id: string
  sourceTable: string
  targetTable: string
  sourceField: RelationGraph['edges'][number]['sourceField']
  targetField: RelationGraph['edges'][number]['targetField']
}

// Each endpoint lookup uses the existing (relation_id, endpoint_id) index. The
// per-relation and total limits bound high-fanout queries before previews load.
export const explorationEdgesSql = `
  SELECT * FROM (
    SELECT l.* FROM unnest($1::uuid[]) d(id) CROSS JOIN LATERAL (
      SELECT relation_id,source_id,target_id FROM iw_data.links
      WHERE relation_id=d.id AND source_id=ANY($2::uuid[])
        AND NOT (relation_id::text||':'||source_id::text||':'||target_id::text=ANY($4::text[]))
      ORDER BY source_id,target_id LIMIT $3
    ) l WHERE $5::text IN ('both','outgoing')
    UNION
    SELECT l.* FROM unnest($1::uuid[]) d(id) CROSS JOIN LATERAL (
      SELECT relation_id,source_id,target_id FROM iw_data.links
      WHERE relation_id=d.id AND target_id=ANY($2::uuid[])
        AND NOT (relation_id::text||':'||source_id::text||':'||target_id::text=ANY($4::text[]))
      ORDER BY target_id,source_id LIMIT $3
    ) l WHERE $5::text IN ('both','incoming')
  ) edges ORDER BY relation_id,source_id,target_id LIMIT $3`

export const sqliteExplorationEdgesSql = `
  SELECT * FROM (
    SELECT l.value->>'relation_id' AS relation_id,l.value->>'source_id' AS source_id,l.value->>'target_id' AS target_id
    FROM json_each($1) d, json_each((
      SELECT json_group_array(json_object('relation_id',relation_id,'source_id',source_id,'target_id',target_id))
      FROM (SELECT relation_id,source_id,target_id FROM links
        WHERE relation_id=d.value AND source_id IN (SELECT value FROM json_each($2))
        AND relation_id||':'||source_id||':'||target_id NOT IN (SELECT value FROM json_each($4))
        ORDER BY source_id,target_id LIMIT $3)
    )) l WHERE $5 IN ('both','outgoing')
    UNION
    SELECT l.value->>'relation_id',l.value->>'source_id',l.value->>'target_id'
    FROM json_each($1) d, json_each((
      SELECT json_group_array(json_object('relation_id',relation_id,'source_id',source_id,'target_id',target_id))
      FROM (SELECT relation_id,source_id,target_id FROM links
        WHERE relation_id=d.value AND target_id IN (SELECT value FROM json_each($2))
        AND relation_id||':'||source_id||':'||target_id NOT IN (SELECT value FROM json_each($4))
        ORDER BY target_id,source_id LIMIT $3)
    )) l WHERE $5 IN ('both','incoming')
  ) edges ORDER BY relation_id,source_id,target_id LIMIT $3`

export async function exploreRelations(
  tableId: string,
  raw: unknown,
  allowedTables?: ReadonlySet<string>,
): Promise<GraphExploration> {
  const input = explorationInput.parse(raw)
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    await db.query("SET LOCAL statement_timeout='3s'")
    const root = (await db.query('SELECT project_id FROM iw_data.tables WHERE id=$1', [tableId]))
      .rows[0]
    if (!root || (allowedTables && !allowedTables.has(tableId)))
      throw new DataError('数据表不在当前接入范围', 404)
    if (input.tableIds) {
      const actual = (
        await db.query('SELECT id FROM iw_data.tables WHERE project_id=$1 AND id=ANY($2::uuid[])', [
          root.project_id,
          input.tableIds,
        ])
      ).rows
      if (
        input.tableIds.some(
          (id) => !actual.some((t) => t.id === id) || (allowedTables && !allowedTables.has(id)),
        )
      )
        throw new DataError('数据表不在当前接入范围', 404)
    }
    const seeds = [...new Set(input.recordIds)]
    const found = (
      await db.query(
        'SELECT id FROM iw_data.record_index WHERE table_id=$1 AND id=ANY($2::uuid[])',
        [tableId, seeds],
      )
    ).rows
    if (found.length !== seeds.length) throw new DataError('起点记录不存在或不在当前表', 404)
    const scopeTables = input.tableIds ? [...new Set([tableId, ...input.tableIds])] : null
    const relations: Relation[] = (
      await db.query(
        `
      SELECT d.id,d.source_table AS "sourceTable",d.target_table AS "targetTable",
        jsonb_build_object('id',f.id,'name',f.name,'multiple',d.source_many) AS "sourceField",
        jsonb_build_object('id',g.id,'name',g.name,'multiple',d.target_many) AS "targetField"
      FROM iw_data.relation_defs d
      JOIN iw_data.tables a ON a.id=d.source_table JOIN iw_data.tables b ON b.id=d.target_table
      JOIN iw_data.fields f ON f.relation_id=d.id AND f.side='source'
      JOIN iw_data.fields g ON g.relation_id=d.id AND g.side='target'
      WHERE a.project_id=$1 AND b.project_id=$1
        AND ($2::uuid[] IS NULL OR (a.id=ANY($2::uuid[]) AND b.id=ANY($2::uuid[])))
        AND ($3::uuid[] IS NULL OR d.id=ANY($3::uuid[]))
      ORDER BY d.id LIMIT 257`,
        [root.project_id, allowedTables ? [...allowedTables] : null, input.relationIds ?? null],
      )
    ).rows
    if (input.relationIds?.some((id) => !relations.some((r) => r.id === id)))
      throw new DataError('关系不在当前接入范围', 404)
    const permitted = relations
      .slice(0, 256)
      .filter(
        (r) =>
          !scopeTables ||
          (scopeTables.includes(r.sourceTable) && scopeTables.includes(r.targetTable)),
      )
    const definitions = new Map(permitted.map((r) => [r.id, r]))
    const nodeTables = new Map(seeds.map((id) => [id, tableId]))
    const edges = new Map<string, RelationGraph['edges'][number]>()
    let frontier = seeds,
      limited = relations.length > 256,
      reachedDepth = 0
    for (let depth = 1; depth <= input.depth && frontier.length; depth++) {
      const frontierTables = new Set(frontier.map((id) => nodeTables.get(id)!))
      const relevant = permitted.filter(
        (r) =>
          (input.direction !== 'incoming' && frontierTables.has(r.sourceTable)) ||
          (input.direction !== 'outgoing' && frontierTables.has(r.targetTable)),
      )
      if (!relevant.length) break
      const budget = input.edgeLimit - edges.size
      const rows = (
        await db.query(isSqlite(db) ? sqliteExplorationEdgesSql : explorationEdgesSql, [
          relevant.map((r) => r.id),
          frontier,
          budget + 1,
          [...edges.keys()],
          input.direction,
        ])
      ).rows
      if (rows.length > budget) limited = true
      const next = new Set<string>()
      for (const row of rows.slice(0, budget)) {
        const relation = definitions.get(row.relation_id)!
        const missing = new Set([row.source_id, row.target_id].filter((id) => !nodeTables.has(id)))
        if (nodeTables.size + missing.size > input.nodeLimit) {
          limited = true
          continue
        }
        nodeTables.set(row.source_id, relation.sourceTable)
        nodeTables.set(row.target_id, relation.targetTable)
        missing.forEach((id) => next.add(id))
        const id = `${relation.id}:${row.source_id}:${row.target_id}`
        edges.set(id, {
          id,
          relationId: relation.id,
          source: row.source_id,
          target: row.target_id,
          label: relation.sourceField.name,
          sourceField: relation.sourceField,
          targetField: relation.targetField,
        })
      }
      reachedDepth = depth
      frontier = [...next]
      if (limited) break
    }
    // A single-table MCP link retains its narrower scope when opened in the full UI.
    const query = allowedTables?.size === 1 ? { ...input, tableIds: [tableId] } : input
    return {
      tableId,
      nodes: await graphNodes(db, nodeTables, new Set(seeds)),
      edges: [...edges.values()],
      limited,
      query,
      observedAt: new Date().toISOString(),
      evidence: 'stored-relations',
      reachedDepth,
      navigation: {
        href: explorationHref(root.project_id, tableId, query),
        requiresView: 'relations',
      },
    }
  })
}
