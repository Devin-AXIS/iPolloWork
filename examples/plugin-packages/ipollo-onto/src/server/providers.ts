import { pool, transaction, identifier } from './db'
import { fieldSourceInput, type FieldSource, type DynamicValueState } from '../core/sources'
import { fieldTypes } from '../core/fields'
import { sourceUsesInput, type FieldDef, type TableData } from '../core/contracts'
import { Registry } from '../core/registry'
import { configuredRequest, readApiJson, jsonPointer } from './api-fetch'
import { DataError } from './errors'
import { apiResponseIssue } from '../plugins/api-response'
import { stockRequest } from '../plugins/tencent-stock'
import { roundApiDecimal } from '../plugins/api-decimal'

interface Provider {
  id: FieldSource['provider']
  request: (
    source: FieldSource,
    input: string,
  ) => {
    url: string
    headers: Record<string, string>
    label: string
    path: string
    timePath: string
    simulated: boolean
    format?: 'tencent-stock'
  }
}
export const providers = new Registry<Provider>()
providers.register({
  id: 'tencent-stock',
  request(source, input) {
    if (source.provider !== 'tencent-stock') throw new DataError('行情配置不正确')
    return {
      url: stockRequest(input),
      headers: { Accept: 'text/plain' },
      label: '腾讯公开美股行情',
      path: `/${source.metric}`,
      timePath: '/date',
      simulated: false,
      format: 'tencent-stock',
    }
  },
})
providers.register({
  id: 'json-api',
  request(source, input) {
    if (source.provider !== 'json-api') throw new DataError('API 配置不正确')
    const request = configuredRequest(source.url, input, source.credential)
    return {
      ...request,
      label: new URL(request.origin).host,
      path: source.valuePath,
      timePath: source.observedAtPath,
      simulated: false,
    }
  },
})
export function validateSource(
  source: FieldSource,
  fields: FieldDef[],
  required: boolean,
  type: string,
) {
  fieldSourceInput.parse(source)
  const input = fields.find((f) => f.id === source.inputFieldId)
  if (
    sourceUsesInput(source) &&
    (!input ||
      input.source ||
      input.type === 'relation' ||
      !['text', 'numeric'].includes(fieldTypes.get(input.type).storage))
  )
    throw new DataError('API 参数需要引用当前表中的普通文本或数字字段')
  if (required || type === 'relation') throw new DataError('API 字段为只读值，不设置必填或关联类型')
  if (
    source.provider === 'json-api' &&
    source.decimalPlaces !== undefined &&
    !['number', 'currency'].includes(type)
  )
    throw new DataError('小数位数仅适用于数字或金额类型')
  if (source.provider === 'demo-stock') throw new DataError('模拟行情来源已停用，请使用真实 API')
  if (
    source.provider === 'tencent-stock' &&
    (source.metric === 'date' ? type !== 'date' : !['number', 'currency'].includes(type))
  )
    throw new DataError('报价日期使用日期类型，股价与成交量使用数字或金额类型')
  const request = providers.get(source.provider).request(source, 'example')
  if (request.path && !request.path.startsWith('/')) throw new DataError('取值路径需要以 / 开头')
  if (request.timePath && !request.timePath.startsWith('/'))
    throw new DataError('时间路径需要以 / 开头')
}
export async function resolveDynamicValues(data: TableData, refresh = false): Promise<TableData> {
  const fields = data.fields.filter((f) => f.source)
  if (!fields.length || !data.records.length) return data
  const previous = new Map(
    data.records.map((r) => [r.id, { values: { ...r.values }, dynamic: { ...r.dynamic } }]),
  )
  const available = (
    await pool.query(
      "SELECT enabled,installed_version FROM iw_data.extension_state WHERE id='api-fields'",
    )
  ).rows[0]
  const signal = AbortSignal.timeout(6500)
  await Promise.all(
    data.records.flatMap((record) =>
      fields.map(async (field) => {
        const source = field.source!,
          input = sourceUsesInput(source) ? record.values[source.inputFieldId] : ''
        const state: DynamicValueState = {
          status: 'unavailable',
          source: source.provider === 'demo-stock' ? '模拟行情 API' : 'JSON API',
          simulated: source.provider === 'demo-stock',
        }
        record.dynamic ??= {}
        record.dynamic[field.id] = state
        record.values[field.id] = null
        try {
          if (source.provider === 'demo-stock')
            throw new DataError('模拟行情来源已停用，请使用真实 API')
          if (!available?.enabled || available.installed_version !== '1.0.0')
            throw new DataError('API 动态字段扩展已停用')
          if (sourceUsesInput(source) && (input == null || String(input).trim() === ''))
            throw new DataError('请先填写关联的参数字段')
          if (typeof input !== 'string' && typeof input !== 'number')
            throw new DataError('API 参数必须是文本或数字')
          const request = providers.get(source.provider).request(source, String(input))
          state.source = request.label
          state.simulated = request.simulated
          const result = await readApiJson(
            { url: request.url, headers: request.headers, format: request.format },
            source.ttlSeconds,
            signal,
            refresh,
          )
          if (!result.fetchedAt) throw new DataError(result.error ?? 'API 暂无数据')
          const issue = apiResponseIssue(request.url, result.data)
          if (issue) {
            state.errorCode = issue.code
            throw new DataError(issue.message)
          }
          state.fetchedAt = new Date(result.fetchedAt).toISOString()
          state.expiresAt = new Date(result.fetchedAt + source.ttlSeconds * 1000).toISOString()
          const value = jsonPointer(result.data, request.path)
          if (value == null) throw new DataError('API 返回的字段值为空')
          const normalized =
            source.provider === 'json-api' && source.decimalPlaces !== undefined
              ? roundApiDecimal(value, source.decimalPlaces)
              : value
          record.values[field.id] = fieldTypes.get(field.type).validate(normalized, field)
          if (request.timePath) {
            const time = jsonPointer(result.data, request.timePath)
            if (typeof time !== 'string' || !Number.isFinite(Date.parse(time)))
              throw new DataError('API 返回的时间无效')
            state.observedAt = new Date(time).toISOString()
          }
          state.status =
            result.error || Date.now() - result.fetchedAt >= source.ttlSeconds * 1000
              ? 'stale'
              : 'fresh'
          if (result.error) state.error = result.error
        } catch (e) {
          const saved = previous.get(record.id)!,
            meta = saved.dynamic[field.id]
          const usable =
            source.storage === 'snapshot' && meta?.fetchedAt && saved.values[field.id] != null
          record.values[field.id] = usable ? saved.values[field.id] : null
          if (usable) Object.assign(state, { ...meta, status: 'stale' })
          else state.status = 'unavailable'
          state.error = e instanceof DataError ? e.message : 'API 字段值与所选类型不匹配'
        }
      }),
    ),
  )
  await persistSnapshots(data, previous)
  return data
}

async function persistSnapshots(
  data: TableData,
  previous: Map<
    string,
    { values: Record<string, unknown>; dynamic: Record<string, DynamicValueState> }
  >,
) {
  const savedFields = data.fields.filter((f) => f.source?.storage === 'snapshot')
  if (!savedFields.length) return
  const plans = data.records
    .map((record) => ({
      record,
      fresh: savedFields.filter(
        (f) =>
          record.dynamic?.[f.id]?.status === 'fresh' &&
          (record.dynamic[f.id].fetchedAt !== previous.get(record.id)!.dynamic[f.id]?.fetchedAt ||
            JSON.stringify(record.values[f.id]) !==
              JSON.stringify(previous.get(record.id)!.values[f.id])),
      ),
    }))
    .filter((p) => p.fresh.length)
  if (!plans.length) return
  await transaction(async (db) => {
    const table = (
      await db.query('SELECT version FROM iw_data.tables WHERE id=$1 FOR SHARE', [data.table.id])
    ).rows[0]
    if (!table || table.version !== data.table.version)
      throw new DataError('数据表结构已改变，请刷新后重试', 409)
    const locked = (
      await db.query(
        'SELECT id,version,api_state FROM iw_data.record_index WHERE id=ANY($1::uuid[]) AND table_id=$2 ORDER BY id FOR UPDATE',
        [plans.map((p) => p.record.id), data.table.id],
      )
    ).rows
    const currentRecords = new Map(locked.map((r) => [r.id, r]))
    for (const { record, fresh } of plans) {
      const current = currentRecords.get(record.id)
      if (!current || current.version !== record.version) {
        for (const f of fresh) {
          record.values[f.id] = null
          record.dynamic![f.id] = {
            ...record.dynamic![f.id],
            status: 'unavailable',
            error: '记录已改变，请刷新后重新获取',
          }
        }
        continue
      }
      const before = previous.get(record.id)!
      const changed = fresh.filter(
        (f) => JSON.stringify(record.values[f.id]) !== JSON.stringify(before.values[f.id]),
      )
      if (changed.length)
        await db.query(
          `UPDATE iw_data.${identifier(data.table.id)} SET ${changed.map((f, i) => `${identifier(f.id, 'f')}=$${i + 2}`).join(',')} WHERE _record_id=$1`,
          [
            record.id,
            ...changed.map((f) =>
              fieldTypes.get(f.type).storage === 'jsonb'
                ? JSON.stringify(record.values[f.id])
                : record.values[f.id],
            ),
          ],
        )
      const state = {
        ...current.api_state,
        ...Object.fromEntries(fresh.map((f) => [f.id, record.dynamic![f.id]])),
      }
      const updated = (
        await db.query(
          `UPDATE iw_data.record_index SET api_state=$2,version=version+$3,updated_at=CASE WHEN $3=1 THEN now() ELSE updated_at END WHERE id=$1 RETURNING version,updated_at AS "updatedAt"`,
          [record.id, JSON.stringify(state), changed.length ? 1 : 0],
        )
      ).rows[0]
      record.version = updated.version
      record.updatedAt = updated.updatedAt
      if (changed.length)
        await db.query(
          "INSERT INTO iw_data.changes(project_id,record_id,operation,details) VALUES($1,$2,'field.snapshot',$3)",
          [
            data.table.projectId,
            record.id,
            JSON.stringify({
              tableId: data.table.id,
              fields: changed.map((f) => ({
                fieldId: f.id,
                value: record.values[f.id],
                ...record.dynamic![f.id],
              })),
            }),
          ],
        )
    }
  })
}
