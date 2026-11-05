import { translate as tr, useLocale } from '../i18n'
import { Select, TextField } from '@radix-ui/themes'
import { sourceUsesInput, type FieldDef } from '../../core/contracts'
import type { FieldSource } from '../../core/sources'
import { fieldTypes } from '../../core/fields'
import { FormLabel } from '../components/primitives'

export function SourceConfig({
  source,
  fields,
  onChange,
  valueType = 'number',
}: {
  source: FieldSource
  fields: FieldDef[]
  onChange: (source: FieldSource) => void
  valueType?: string
}) {
  useLocale()
  const inputs = fields.filter(
    (f) =>
      !f.source &&
      f.type !== 'relation' &&
      fieldTypes.has(f.type) &&
      ['text', 'numeric'].includes(fieldTypes.get(f.type).storage),
  )
  const usesInput = sourceUsesInput(source)
  return (
    <div className="source-config form-stack">
      <FormLabel label={tr('数据来源')}>
        <Select.Root
          value={source.provider}
          onValueChange={(provider) => {
            const common = {
              inputFieldId: source.inputFieldId,
              storage: source.storage,
              ttlSeconds: source.ttlSeconds,
              unit: source.unit,
            }
            onChange(
              provider === 'tencent-stock'
                ? {
                    ...common,
                    provider: 'tencent-stock',
                    metric: valueType === 'date' ? 'date' : 'price',
                    unit: valueType === 'date' ? '' : 'USD',
                  }
                : {
                    ...common,
                    provider: 'json-api',
                    url: '',
                    valuePath: '/value',
                    observedAtPath: '',
                  },
            )
          }}
        >
          <Select.Trigger aria-label={tr('API 数据来源')} />
          <Select.Content>
            <Select.Item value="json-api">{tr('自定义 API')}</Select.Item>
            {['number', 'currency', 'date'].includes(valueType) && (
              <Select.Item value="tencent-stock">{tr('腾讯公开美股行情')}</Select.Item>
            )}
          </Select.Content>
        </Select.Root>
      </FormLabel>
      {source.provider === 'json-api' && (
        <>
          <FormLabel label={tr('API 地址')}>
            <TextField.Root
              required
              value={source.url}
              maxLength={2000}
              placeholder="https://api.example.com/data"
              onChange={(e) =>
                onChange({
                  ...source,
                  url: e.target.value,
                  inputFieldId: e.target.value.includes('{{value}}') ? source.inputFieldId : '',
                })
              }
            />
          </FormLabel>
          <p className="form-hint">{tr('地址需要本行参数时，用 {{value}} 标记。')}</p>
        </>
      )}
      {usesInput && (
        <>
          <FormLabel label={tr('参数字段')}>
            <Select.Root
              value={source.inputFieldId}
              onValueChange={(inputFieldId) => onChange({ ...source, inputFieldId })}
            >
              <Select.Trigger aria-label={tr('API 参数字段')} placeholder={tr('选择本行字段')} />
              <Select.Content>
                {inputs.map((f) => (
                  <Select.Item value={f.id} key={f.id}>
                    {f.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </FormLabel>
          {!inputs.length && (
            <p className="form-hint">{tr('此接口需要一个普通文本或数字字段作为参数。')}</p>
          )}
        </>
      )}
      {source.provider === 'tencent-stock' && (
        <FormLabel label={tr('行情指标')}>
          <Select.Root
            value={source.metric}
            onValueChange={(metric) =>
              onChange({
                ...source,
                metric: metric as 'price' | 'previousClose' | 'volume' | 'date',
                unit: ['price', 'previousClose'].includes(metric)
                  ? 'USD'
                  : metric === 'volume'
                    ? tr('股')
                    : '',
              })
            }
          >
            <Select.Trigger aria-label={tr('行情指标')} />
            <Select.Content>
              {valueType === 'date' ? (
                <Select.Item value="date">{tr('报价日期')}</Select.Item>
              ) : (
                <>
                  <Select.Item value="price">{tr('股价')}</Select.Item>
                  <Select.Item value="previousClose">{tr('前收盘价')}</Select.Item>
                  <Select.Item value="volume">{tr('成交量')}</Select.Item>
                </>
              )}
            </Select.Content>
          </Select.Root>
        </FormLabel>
      )}
      {source.provider === 'json-api' && (
        <FormLabel label={tr('结果取值路径')}>
          <TextField.Root
            value={source.valuePath}
            placeholder="/data/value"
            onChange={(e) => onChange({ ...source, valuePath: e.target.value })}
          />
        </FormLabel>
      )}
      <FormLabel label={tr('数据保存方式')}>
        <Select.Root
          value={source.storage}
          onValueChange={(storage) =>
            onChange({ ...source, storage: storage as 'live' | 'snapshot' })
          }
        >
          <Select.Trigger aria-label={tr('数据保存方式')} />
          <Select.Content>
            <Select.Item value="live">{tr('只读取 · 不保存')}</Select.Item>
            <Select.Item value="snapshot">{tr('获取并保存 · 保留上次结果')}</Select.Item>
          </Select.Content>
        </Select.Root>
      </FormLabel>
      <details className="field-advanced">
        <summary>{tr('更多设置')}</summary>
        <div className="form-stack">
          {source.provider === 'json-api' && (
            <>
              <FormLabel label={tr('来源时间路径（可选）')}>
                <TextField.Root
                  value={source.observedAtPath}
                  placeholder="/observedAt"
                  onChange={(e) => onChange({ ...source, observedAtPath: e.target.value })}
                />
              </FormLabel>
              <FormLabel label={tr('凭据名称（可选）')}>
                <TextField.Root
                  value={source.credential ?? ''}
                  placeholder={tr('已配置的凭据名称')}
                  onChange={(e) => onChange({ ...source, credential: e.target.value || undefined })}
                />
              </FormLabel>
              {['number', 'currency'].includes(valueType) && (
                <FormLabel label={tr('数字精度')}>
                  <Select.Root
                    value={
                      source.decimalPlaces === undefined ? 'original' : String(source.decimalPlaces)
                    }
                    onValueChange={(value) =>
                      onChange({
                        ...source,
                        decimalPlaces: value === 'original' ? undefined : Number(value),
                      })
                    }
                  >
                    <Select.Trigger aria-label={tr('数字精度')} />
                    <Select.Content>
                      <Select.Item value="original">{tr('保持原值 · 最多四位小数')}</Select.Item>
                      {[0, 1, 2, 3, 4].map((n) => (
                        <Select.Item key={n} value={String(n)}>
                          {tr('四舍五入 ·')}
                          {n} {tr('位小数')}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </FormLabel>
              )}
            </>
          )}
          <div className="database-login-row">
            <FormLabel label={tr('刷新间隔（秒）')}>
              <TextField.Root
                required
                type="number"
                min={5}
                max={3600}
                value={source.ttlSeconds || ''}
                onChange={(e) => onChange({ ...source, ttlSeconds: Number(e.target.value) })}
              />
            </FormLabel>
            <FormLabel label={tr('显示单位（可选）')}>
              <TextField.Root
                value={source.unit}
                maxLength={12}
                onChange={(e) => onChange({ ...source, unit: e.target.value })}
              />
            </FormLabel>
          </div>
        </div>
      </details>
    </div>
  )
}
