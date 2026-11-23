import { translate as tr, useLocale, getLocale, translateMessage } from '../i18n'
import type { DynamicValueState } from '../../core/sources'
import { ArrowTopRightIcon, CheckIcon, ExclamationTriangleIcon } from '@radix-ui/react-icons'
import { Badge, Spinner } from '@radix-ui/themes'
import { fieldTypes } from '../../core/fields'
import { display, links, type FieldDef } from '../../core/contracts'
import { RelativeTime } from '../components/relative-time'

export function FieldValue({
  field,
  value,
  state,
}: {
  field: FieldDef
  value: unknown
  state?: DynamicValueState
}) {
  useLocale()
  if (!field.source) return <StoredValue field={field} value={value} />
  const expired = state?.expiresAt && Date.parse(state.expiresAt) < Date.now()
  const status = state?.status === 'fresh' && expired ? 'stale' : (state?.status ?? 'loading')
  const refreshedAt =
    state?.fetchedAt && Number.isFinite(Date.parse(state.fetchedAt))
      ? new Date(state.fetchedAt)
      : undefined
  const refreshedLabel = refreshedAt
    ? tr('刷新于 {0}', {
        0: refreshedAt.toLocaleString(getLocale(), {
          dateStyle: 'short',
          timeStyle: 'medium',
          hour12: false,
        }),
      })
    : undefined
  const simulated = state?.simulated || field.source.provider === 'demo-stock'
  const error = state?.error
    ? translateMessage(state.error)
    : status === 'unavailable'
      ? tr('刷新失败')
      : undefined
  const details = [refreshedLabel, simulated ? tr('模拟数据') : undefined, error]
    .filter(Boolean)
    .join('；')
  return (
    <span className={`api-field-value ${status}`} title={details}>
      <span className="api-field-number">
        {status === 'loading' && value == null ? (
          <>
            <Spinner size="1" />
            {tr('读取中')}
          </>
        ) : value == null ? (
          state?.errorCode === 'credentials_required' ? (
            tr('需配置行情凭据')
          ) : (
            tr('暂不可用')
          )
        ) : (
          <>
            <StoredValue field={field} value={value} />
            {field.source.unit && <span className="api-unit">{field.source.unit}</span>}
            {error && (
              <span
                className="api-field-warning"
                role="img"
                aria-label={tr('刷新失败')}
                title={error}
              >
                <ExclamationTriangleIcon />
              </span>
            )}
          </>
        )}
      </span>
      {refreshedAt && <RelativeTime date={refreshedAt} quietForSeconds={error ? 0 : 30 * 60} />}
      {simulated && <small>{tr('模拟数据')}</small>}
    </span>
  )
}
function StoredValue({ field, value }: { field: FieldDef; value: unknown }) {
  useLocale()
  if (field.type === 'datetime' && value)
    return <span>{new Date(String(value)).toLocaleString(getLocale(), { hour12: false })}</span>
  if (field.type === 'relation')
    return (
      <span className="link-values">
        {links(value).map((link) => (
          <span className="link-chip" key={link.id}>
            <ArrowTopRightIcon />
            {link.label}
          </span>
        ))}
      </span>
    )
  if (value === null || value === undefined || value === '')
    return <span className="empty-value">—</span>
  if (field.type === 'boolean')
    return (
      <span className={`check-value ${value ? 'checked' : ''}`}>
        {value ? <CheckIcon /> : null}
      </span>
    )
  if (['tags', 'multiselect'].includes(field.type) && Array.isArray(value))
    return (
      <span className="link-values">
        {value.map((v) => (
          <Badge color="gray" key={String(v)}>
            {String(v)}
          </Badge>
        ))}
      </span>
    )
  if (field.type === 'progress')
    return (
      <span className="progress-value">
        <progress max={100} value={Number(value)} aria-label={field.name} />
        {String(value)}%
      </span>
    )
  if (field.type === 'select')
    return (
      <Badge
        color={
          ['green', 'blue', 'orange', 'gray'][
            Math.max(0, field.options.indexOf(String(value))) % 4
          ] === 'blue'
            ? 'blue'
            : field.options.indexOf(String(value)) === 0
              ? 'green'
              : 'gray'
        }
        variant="soft"
        radius="full"
      >
        {String(value)}
      </Badge>
    )
  return (
    <span className={field.type === 'number' || field.type === 'currency' ? 'numeric' : ''}>
      {fieldTypes.has(field.type)
        ? fieldTypes.get(field.type).format(value)
        : tr('{0}（扩展未加载）', { 0: display(value) })}
    </span>
  )
}
