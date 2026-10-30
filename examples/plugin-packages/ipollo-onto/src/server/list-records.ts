import { z } from 'zod'
import { recordListShape } from '../core/query'
import * as store from './store'
import { pool } from './db'
import { DataError } from './errors'
import { resolveDynamicValues } from './providers'
import type { SavedQueryView } from '../core/query'

export const recordListInput = z.object(recordListShape).strict()
export async function listRecords(
  tableId: string,
  raw: unknown,
  mode: 'saved' | 'resolve' | 'refresh' = 'saved',
  allowedTables?: Set<string>,
) {
  const input = recordListInput.parse(raw)
  if ((input.viewId && (input.selection || input.query)) || (input.selection && input.query))
    throw new DataError('保存视图、结构化查询和旧版搜索只能选择一种')
  let selection = input.selection
  if (input.viewId) {
    const views: SavedQueryView[] =
      (await pool.query('SELECT query_views FROM iw_data.tables WHERE id=$1', [tableId])).rows[0]
        ?.query_views ?? []
    const view = views.find((v) => v.id === input.viewId)
    if (!view) throw new DataError('视图不存在', 404)
    selection = view.query
  }
  const read = () =>
    store.getData(tableId, input.page, input.query, undefined, selection, allowedTables)
  const data = await read()
  if (mode === 'saved' || (mode === 'resolve' && data.queryInfo.snapshotFields.length)) return data
  const resolved = await resolveDynamicValues(data, mode === 'refresh')
  // A refresh may change membership or order. Re-evaluate committed snapshots before returning.
  return data.queryInfo.snapshotFields.length ? read() : resolved
}
