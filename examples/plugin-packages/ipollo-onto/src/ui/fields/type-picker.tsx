import { FieldTypeIcon } from '../components/icons'
import { translate as tr, useLocale } from '../i18n'
import { useState } from 'react'
import { Button, Popover, TextField } from '@radix-ui/themes'
import { ChevronDownIcon, CheckIcon } from '@radix-ui/react-icons'
import { fieldTypes } from '../../core/fields'
import { availableContribution } from '../../core/extensions'
import { useExtensions } from '../extension-context'

const groups = {
  api: 'API 与实时数据',
  text: '文本与联系',
  number: '数字与度量',
  choice: '选择与标签',
  date: '日期与时间',
  media: '文件与媒体',
  data: '结构与关系',
}
const basicGroups: Record<string, keyof typeof groups> = {
  text: 'text',
  longtext: 'text',
  url: 'text',
  number: 'number',
  currency: 'number',
  percentage: 'number',
  select: 'choice',
  boolean: 'choice',
  date: 'date',
  json: 'data',
}
export function FieldTypePicker({
  value,
  onChange,
  resultOnly = false,
  allowedTypes,
  label,
}: {
  value: string
  onChange: (value: string) => void
  resultOnly?: boolean
  allowedTypes?: string[]
  label?: string
}) {
  useLocale()
  const { extensions } = useExtensions(),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState('')
  const choices = [
    ...(!resultOnly && availableContribution(extensions, 'providers', 'json-api')
      ? [
          {
            id: 'api',
            label: tr('API 实时字段'),
            group: 'api' as const,
            description: tr('从接口获取数据，可只读取或获取并保存'),
          },
        ]
      : []),
    ...fieldTypes
      .list()
      .filter((f) => availableContribution(extensions, 'fields', f.id))
      .filter((f) => !allowedTypes || allowedTypes.includes(f.id))
      .map((f) => ({
        id: f.id,
        label: tr(f.label),
        group: f.group ?? basicGroups[f.id] ?? 'data',
        description: tr(f.description ?? ''),
      })),
    ...(!resultOnly
      ? [
          {
            id: 'relation',
            label: tr('关联记录'),
            group: 'data' as const,
            description: tr('单条或多条记录，双向关联'),
          },
        ]
      : []),
  ]
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button
          variant="surface"
          color="gray"
          type="button"
          className="field-type-trigger"
          aria-label={label ?? (resultOnly ? tr('返回内容类型') : tr('字段类型'))}
        >
          <FieldTypeIcon type={value} />
          <span className="field-type-label">
            {choices.find((c) => c.id === value)?.label ?? tr('选择类型')}
          </span>
          <ChevronDownIcon />
        </Button>
      </Popover.Trigger>
      <Popover.Content width="440px" maxWidth="calc(100vw - 32px)">
        <TextField.Root
          autoFocus
          aria-label={tr('搜索字段类型')}
          placeholder={tr('搜索字段类型')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="field-type-options">
          {Object.entries(groups).map(([group, label]) => {
            const items = choices.filter(
              (c) =>
                c.group === group &&
                `${c.label} ${c.id}`.toLowerCase().includes(query.toLowerCase()),
            )
            return items.length ? (
              <div key={group} role="group" aria-label={tr(label)}>
                <small>{tr(label)}</small>
                <div>
                  {items.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={c.id === value}
                      title={c.description}
                      onClick={() => {
                        onChange(c.id)
                        setOpen(false)
                        setQuery('')
                      }}
                    >
                      <FieldTypeIcon type={c.id} />
                      <span className="field-type-label">{c.label}</span>
                      {c.id === value ? <CheckIcon /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          })}
          {!choices.some((c) =>
            `${c.label} ${c.id}`.toLowerCase().includes(query.toLowerCase()),
          ) ? (
            <p className="form-hint">{tr('没有匹配的字段类型')}</p>
          ) : null}
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
