import { useEffect, useState } from 'react'
import { Button, Popover, IconButton, TextField, DropdownMenu } from '@radix-ui/themes'
import {
  MixerHorizontalIcon,
  PlusIcon,
  Cross2Icon,
  CopyIcon,
  BookmarkIcon,
  ChevronDownIcon,
  TrashIcon,
} from '@radix-ui/react-icons'
import {
  emptyQuery,
  filterCount,
  recordQueryInput,
  type FilterCondition,
  type FilterGroup,
  type FilterOperator,
  type QueryField,
  type QueryContext,
  type RecordQuery,
  type SavedQueryView,
} from '../../core/query'
import type { TableData } from '../../core/contracts'
import { translate as tr, useLocale } from '../i18n'
import { api, message } from '../api'
import { ErrorNotice } from './primitives'
import { FieldTypeIcon } from './icons'
import { FieldInput } from '../fields/input'
import { ChoiceInput, SelectInput } from '../fields/input-controls'

const operatorLabels: Record<FilterOperator, string> = {
  eq: '等于',
  neq: '不等于',
  contains: '包含文本',
  startsWith: '开头是',
  in: '是其中之一',
  notIn: '不是其中之一',
  gt: '大于',
  gte: '大于或等于',
  lt: '小于',
  lte: '小于或等于',
  isEmpty: '为空',
  isNotEmpty: '不为空',
  hasAny: '包含任意一项',
  hasAll: '包含全部选项',
  notHasAny: '不包含这些选项',
}
const noValue = (op: FilterOperator) => op === 'isEmpty' || op === 'isNotEmpty'
const listValue = (op: FilterOperator) =>
  ['in', 'notIn', 'hasAny', 'hasAll', 'notHasAny'].includes(op)
function initialCondition(
  info: QueryField,
  fieldId = info.field.id,
  relatedFieldId?: string,
): FilterCondition {
  const operator = info.operators[0] ?? 'isNotEmpty'
  return {
    fieldId,
    ...(relatedFieldId ? { relatedFieldId } : {}),
    operator,
    ...(!noValue(operator) ? { value: info.kind === 'boolean' ? true : '' } : {}),
  }
}
function ValueInput({
  info,
  condition,
  onChange,
}: {
  info: QueryField
  condition: FilterCondition
  onChange: (value: FilterCondition['value']) => void
}) {
  if (noValue(condition.operator)) return null
  if (info.kind === 'relation')
    return (
      <FieldInput
        field={{ ...info.field, multiple: true }}
        value={condition.value}
        onChange={(v) => onChange(v as string[])}
      />
    )
  if (listValue(condition.operator)) {
    const chosen = Array.isArray(condition.value) ? condition.value : []
    if (info.field.options.length)
      return (
        <ChoiceInput
          field={info.field}
          value={chosen}
          onChange={(v) => onChange(v as string[])}
          choices={info.field.options.map((v) => ({ id: v, label: v }))}
        />
      )
    return (
      <TextField.Root
        aria-label={tr('筛选值')}
        placeholder={tr('多个值用逗号分隔')}
        value={typeof condition.value === 'string' ? condition.value : chosen.join(', ')}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (info.kind === 'boolean')
    return (
      <select
        className="query-select"
        aria-label={tr('筛选值')}
        value={String(condition.value ?? true)}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">{tr('是')}</option>
        <option value="false">{tr('否')}</option>
      </select>
    )
  if (info.kind === 'choice')
    return (
      <SelectInput
        field={info.field}
        value={condition.value}
        onChange={(v) => onChange(v as string)}
      />
    )
  if (['date', 'datetime', 'time'].includes(info.kind))
    return (
      <FieldInput
        field={info.field}
        value={condition.value}
        onChange={(v) => onChange(v as string)}
      />
    )
  return (
    <TextField.Root
      aria-label={tr('筛选值')}
      type={
        info.kind === 'number'
          ? 'number'
          : info.kind === 'date'
            ? 'date'
            : info.kind === 'time'
              ? 'time'
              : 'text'
      }
      step="any"
      value={String(condition.value ?? '')}
      placeholder={tr('输入筛选值')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
function ConditionRow({
  condition,
  fields,
  onChange,
  onRemove,
}: {
  condition: FilterCondition
  fields: QueryField[]
  onChange: (c: FilterCondition) => void
  onRemove: () => void
}) {
  const own = fields.find((f) => f.field.id === condition.fieldId)
  const info = condition.relatedFieldId
    ? own?.related?.find((f) => f.field.id === condition.relatedFieldId)
    : own
  const options = info?.operators ?? []
  return (
    <div className="query-condition">
      <div className="query-field-choice">
        {own && <FieldTypeIcon type={own.field.type} source={own.field.source} />}
        <select
          className="query-select"
          aria-label={tr('筛选字段')}
          value={condition.fieldId}
          onChange={(e) => {
            const next = fields.find((f) => f.field.id === e.target.value)
            if (next) onChange(initialCondition(next))
          }}
        >
          {!own && <option value={condition.fieldId}>{tr('字段已不存在')}</option>}
          {fields.map((f) => (
            <option key={f.field.id} value={f.field.id} disabled={Boolean(f.reason)}>
              {f.field.name}
              {f.reason === 'live'
                ? ` · ${tr('动态读取')}`
                : f.reason
                  ? ` · ${tr('扩展未加载')}`
                  : ''}
            </option>
          ))}
        </select>
      </div>
      {own?.related && (
        <select
          className="query-select query-related"
          aria-label={tr('关联表中的字段')}
          value={condition.relatedFieldId ?? ''}
          onChange={(e) => {
            const related = own.related?.find((f) => f.field.id === e.target.value)
            onChange(
              related
                ? initialCondition(related, own.field.id, related.field.id)
                : initialCondition(own),
            )
          }}
        >
          <option value="">{tr('关联记录本身')}</option>
          {own.related.map((f) => (
            <option value={f.field.id} key={f.field.id} disabled={Boolean(f.reason)}>
              {f.field.name}
              {f.reason === 'live' ? ` · ${tr('动态读取')}` : ''}
            </option>
          ))}
        </select>
      )}
      <select
        className="query-select"
        aria-label={tr('比较方式')}
        value={condition.operator}
        onChange={(e) => {
          const operator = e.target.value as FilterOperator
          onChange({
            fieldId: condition.fieldId,
            relatedFieldId: condition.relatedFieldId,
            operator,
            ...(!noValue(operator)
              ? { value: info?.kind === 'boolean' ? true : listValue(operator) ? [] : '' }
              : {}),
          })
        }}
      >
        {!options.includes(condition.operator) && (
          <option value={condition.operator}>{tr('条件不可用')}</option>
        )}
        {options.map((op) => (
          <option key={op} value={op}>
            {tr(operatorLabels[op])}
          </option>
        ))}
      </select>
      <IconButton
        type="button"
        className="query-remove"
        color="gray"
        variant="ghost"
        aria-label={tr('删除条件')}
        onClick={onRemove}
      >
        <Cross2Icon />
      </IconButton>
      {info && !noValue(condition.operator) && (
        <div className="query-value">
          <ValueInput
            info={info}
            condition={condition}
            onChange={(value) => onChange({ ...condition, value })}
          />
        </div>
      )}
      {condition.relatedFieldId && (
        <small className="query-row-note">{tr('至少一个关联记录满足此条件')}</small>
      )}
    </div>
  )
}
function GroupEditor({
  group,
  fields,
  onChange,
  depth = 0,
  remaining,
}: {
  group: FilterGroup
  fields: QueryField[]
  onChange: (g: FilterGroup) => void
  depth?: number
  remaining: number
}) {
  const usable = fields.find((f) => !f.reason)
  return (
    <div className={`query-group ${depth ? 'query-group-nested' : ''}`}>
      <div className="query-group-heading">
        <span>{tr('以下条件')}</span>
        <select
          className="query-select"
          aria-label={tr('条件组合')}
          value={group.conjunction}
          onChange={(e) => onChange({ ...group, conjunction: e.target.value as 'and' | 'or' })}
        >
          <option value="and">{tr('全部满足')}</option>
          <option value="or">{tr('任一满足')}</option>
        </select>
      </div>
      {group.conditions.map((child, index) => {
        const update = (value: FilterGroup | FilterCondition) =>
          onChange({
            ...group,
            conditions: group.conditions.map((c, i) => (i === index ? value : c)),
          })
        const remove = () =>
          onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) })
        return 'conditions' in child ? (
          <div className="query-nested-wrap" key={index}>
            <GroupEditor
              group={child}
              fields={fields}
              depth={depth + 1}
              remaining={remaining}
              onChange={update}
            />
            <IconButton
              className="query-remove-group"
              color="gray"
              variant="ghost"
              aria-label={tr('删除条件组')}
              onClick={remove}
            >
              <Cross2Icon />
            </IconButton>
          </div>
        ) : (
          <ConditionRow
            key={index}
            condition={child}
            fields={fields}
            onChange={update}
            onRemove={remove}
          />
        )
      })}
      {!group.conditions.length && <p className="query-muted">{tr('未设置条件，显示全部记录')}</p>}
      <div className="query-add-actions">
        <Button
          type="button"
          size="1"
          variant="ghost"
          disabled={!usable || remaining <= 0}
          onClick={() =>
            usable &&
            onChange({ ...group, conditions: [...group.conditions, initialCondition(usable)] })
          }
        >
          <PlusIcon />
          {tr('添加条件')}
        </Button>
        {depth < 2 && (
          <Button
            type="button"
            size="1"
            variant="ghost"
            disabled={!usable || remaining <= 0}
            onClick={() =>
              usable &&
              onChange({
                ...group,
                conditions: [
                  ...group.conditions,
                  { conjunction: 'or', conditions: [initialCondition(usable)] },
                ],
              })
            }
          >
            <PlusIcon />
            {tr('条件组')}
          </Button>
        )}
      </div>
    </div>
  )
}
function normalizeGroup(group: FilterGroup): FilterGroup | undefined {
  const conditions = group.conditions.flatMap((child): Array<FilterGroup | FilterCondition> => {
    if ('conditions' in child) {
      const next = normalizeGroup(child)
      return next ? [next] : []
    }
    const value =
      listValue(child.operator) && typeof child.value === 'string'
        ? child.value
            .split(/[,，\n]/)
            .map((v) => v.trim())
            .filter(Boolean)
        : child.value
    if (listValue(child.operator) && (!Array.isArray(value) || !value.length))
      throw new Error(tr('请至少选择或输入一个筛选值'))
    if (!noValue(child.operator) && value === '')
      throw new Error(tr('请填写筛选值；查找空值请使用“为空”'))
    return [{ ...child, ...(noValue(child.operator) ? {} : { value }) }]
  })
  return conditions.length ? { ...group, conditions } : undefined
}

export function QueryControls({
  data,
  selection,
  layout,
  onChange,
  onSaved,
}: {
  data: TableData
  selection: RecordQuery
  layout: string
  onChange: (query: RecordQuery, layout?: string) => void
  onSaved: () => void
}) {
  useLocale()
  const [context, setContext] = useState<QueryContext>()
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(selection)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [saving, setSaving] = useState(false),
    [copied, setCopied] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    api<QueryContext>(`/tables/${data.table.id}/query-context`)
      .then((v) => {
        if (active) {
          setContext(v)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [data.table.id, data.table.version, revision])
  const fields = context?.fields ?? []
  const selected = context?.views.find(
    (v) => JSON.stringify(v.query) === JSON.stringify(selection) && v.layout === layout,
  )
  const group: FilterGroup = draft.filter ?? { conjunction: 'and', conditions: [] }
  function changeOpen(next: boolean) {
    setOpen(next)
    if (next) {
      setDraft(selection)
      setError('')
      setSaving(false)
      setCopied(false)
      setRevision((v) => v + 1)
    }
  }
  async function apply(save = false) {
    setBusy(true)
    setError('')
    try {
      const query = recordQueryInput.parse({ ...draft, filter: normalizeGroup(group) })
      // Preview through the same deterministic read API before replacing the visible query.
      await api(`/tables/${data.table.id}/query`, 'POST', { selection: query })
      if (save) {
        if (!context) throw new Error(tr('正在读取筛选字段…'))
        await api(`/tables/${data.table.id}/views`, 'POST', {
          name,
          layout,
          query,
          version: context.version,
        })
        onSaved()
        setRevision((v) => v + 1)
      }
      onChange(query)
      setOpen(false)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function removeView(view: SavedQueryView) {
    if (!context) return
    setBusy(true)
    try {
      await api(`/tables/${data.table.id}/views/${view.id}`, 'DELETE', { version: context.version })
      setRevision((v) => v + 1)
      onSaved()
    } catch (e) {
      setError(message(e))
      setOpen(true)
    } finally {
      setBusy(false)
    }
  }
  const count = filterCount(selection.filter)
  return (
    <div className="query-controls">
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger>
          <Button
            variant={count || selection.sort.length ? 'soft' : 'ghost'}
            color="gray"
            aria-label={tr('筛选与排序')}
          >
            <MixerHorizontalIcon />
            {tr('筛选')}
            {count > 0 && <span className="query-count">{count}</span>}
            {selection.sort.length > 0 && (
              <span className="query-sort-count">↑↓ {selection.sort.length}</span>
            )}
          </Button>
        </Popover.Trigger>
        <Popover.Content
          className="query-popover"
          align="start"
          sideOffset={10}
          aria-label={tr('筛选与排序')}
        >
          <div className="query-heading">
            <b>{tr('筛选与排序')}</b>
            <IconButton
              color="gray"
              variant="ghost"
              aria-label={tr('关闭筛选')}
              onClick={() => setOpen(false)}
            >
              <Cross2Icon />
            </IconButton>
          </div>
          <div className="query-editor-scroll">
            {!context ? (
              <p className="query-muted">{tr('正在读取筛选字段…')}</p>
            ) : (
              <>
                <GroupEditor
                  group={group}
                  fields={fields}
                  remaining={40 - filterCount(group)}
                  onChange={(filter) =>
                    setDraft({ ...draft, filter: filter as RecordQuery['filter'] })
                  }
                />
                <div className="query-sort-section">
                  <b>{tr('排序')}</b>
                  {draft.sort.map((sort, index) => (
                    <div className="query-sort-row" key={index}>
                      <select
                        className="query-select"
                        aria-label={tr('排序字段')}
                        value={sort.fieldId}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            sort: draft.sort.map((s, i) =>
                              i === index ? { ...s, fieldId: e.target.value } : s,
                            ),
                          })
                        }
                      >
                        {fields
                          .filter(
                            (f) =>
                              f.sortable &&
                              (!draft.sort.some((s) => s.fieldId === f.field.id) ||
                                f.field.id === sort.fieldId),
                          )
                          .map((f) => (
                            <option value={f.field.id} key={f.field.id}>
                              {f.field.name}
                            </option>
                          ))}
                      </select>
                      <select
                        className="query-select"
                        aria-label={tr('排序方向')}
                        value={sort.direction}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            sort: draft.sort.map((s, i) =>
                              i === index
                                ? { ...s, direction: e.target.value as 'asc' | 'desc' }
                                : s,
                            ),
                          })
                        }
                      >
                        <option value="asc">{tr('升序')}</option>
                        <option value="desc">{tr('降序')}</option>
                      </select>
                      <IconButton
                        color="gray"
                        variant="ghost"
                        aria-label={tr('删除排序')}
                        onClick={() =>
                          setDraft({ ...draft, sort: draft.sort.filter((_, i) => i !== index) })
                        }
                      >
                        <Cross2Icon />
                      </IconButton>
                    </div>
                  ))}
                  <Button
                    size="1"
                    variant="ghost"
                    disabled={
                      draft.sort.length >= 3 ||
                      !fields.some(
                        (f) => f.sortable && !draft.sort.some((s) => s.fieldId === f.field.id),
                      )
                    }
                    onClick={() => {
                      const first = fields.find(
                        (f) => f.sortable && !draft.sort.some((s) => s.fieldId === f.field.id),
                      )
                      if (first)
                        setDraft({
                          ...draft,
                          sort: [...draft.sort, { fieldId: first.field.id, direction: 'asc' }],
                        })
                    }}
                  >
                    <PlusIcon />
                    {tr('添加排序')}
                  </Button>
                </div>
                {fields.some((f) => f.field.source || f.related?.some((r) => r.field.source)) && (
                  <p className="query-muted">
                    {tr('API 字段按已保存的快照筛选；动态读取字段暂不参与全表筛选。')}
                  </p>
                )}
              </>
            )}
            <ErrorNotice error={error} />
            {saving && (
              <TextField.Root
                autoFocus
                aria-label={tr('视图名称')}
                placeholder={tr('为这个视图命名')}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </div>
          <div className="query-footer">
            <Button
              variant="ghost"
              color="gray"
              disabled={busy}
              onClick={() => {
                setDraft({ ...emptyQuery(), search: selection.search })
                onChange({ ...emptyQuery(), search: selection.search })
                setOpen(false)
              }}
            >
              {tr('清除条件')}
            </Button>
            <div>
              <IconButton
                variant="ghost"
                color="gray"
                aria-label={tr('复制查询条件')}
                title={tr('复制查询条件')}
                onClick={async () => {
                  try {
                    const query = recordQueryInput.parse({
                      ...draft,
                      filter: normalizeGroup(group),
                    })
                    await navigator.clipboard.writeText(
                      JSON.stringify({ selection: query }, null, 2),
                    )
                    setCopied(true)
                  } catch (e) {
                    setError(message(e))
                  }
                }}
              >
                <CopyIcon />
              </IconButton>
              <Button
                variant="soft"
                color="gray"
                disabled={busy || !context}
                onClick={() => {
                  setSaving(!saving)
                  setName('')
                }}
              >
                <BookmarkIcon />
                {tr('保存为视图')}
              </Button>
              <Button
                loading={busy}
                disabled={!context || (saving && !name.trim())}
                onClick={() => void apply(saving)}
              >
                {saving ? tr('保存并应用') : tr('应用筛选')}
              </Button>
            </div>
          </div>
          {copied && (
            <span className="query-muted" role="status">
              {tr('已复制查询条件，可交给 AI 继续修改')}
            </span>
          )}
        </Popover.Content>
      </Popover.Root>
      {!!context?.views.length && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button variant="ghost" color="gray" className="saved-view-trigger">
              <BookmarkIcon />
              <span>{selected?.name ?? tr('已保存视图')}</span>
              <ChevronDownIcon />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => onChange(emptyQuery())}>
              {tr('全部记录')}
            </DropdownMenu.Item>
            {context.views.map((v) => (
              <DropdownMenu.Item key={v.id} onSelect={() => onChange(v.query, v.layout)}>
                {v.name}
              </DropdownMenu.Item>
            ))}
            {selected && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  disabled={busy}
                  onSelect={() => void removeView(selected)}
                >
                  <TrashIcon />
                  {tr('删除当前视图')}
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      )}
    </div>
  )
}

export function QuerySummary({ data, onClear }: { data: TableData; onClear: () => void }) {
  const query = data.appliedQuery
  if (!query?.filter && !query?.sort.length) return null
  function describe(group: FilterGroup): string {
    return group.conditions
      .map((c) => {
        if ('conditions' in c) return `(${describe(c)})`
        const field = data.fields.find((f) => f.id === c.fieldId)
        const value =
          typeof c.value === 'boolean'
            ? tr(c.value ? '是' : '否')
            : Array.isArray(c.value)
              ? c.value.join('、')
              : (c.value ?? '')
        return `${field?.name ?? tr('字段已不存在')}${c.relatedFieldId ? ` → ${data.queryInfo?.labels?.[c.relatedFieldId] ?? tr('关联字段')}` : ''} ${tr(operatorLabels[c.operator])} ${field?.type === 'relation' && !c.relatedFieldId && Array.isArray(c.value) ? tr('{0} 条记录', { 0: c.value.length }) : value}`.trim()
      })
      .join(group.conjunction === 'and' ? ` ${tr('且')} ` : ` ${tr('或')} `)
  }
  return (
    <div className="query-summary">
      <span title={query.filter ? describe(query.filter) : ''}>
        {query.filter ? describe(query.filter) : tr('全部记录')}
        {query.sort.length
          ? ` · ${query.sort.map((s) => `${data.fields.find((f) => f.id === s.fieldId)?.name ?? tr('字段已不存在')} ${s.direction === 'asc' ? '↑' : '↓'}`).join('、')}`
          : ''}
      </span>
      {!!data.queryInfo?.snapshotFields.length && <small>{tr('按已保存快照')}</small>}
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        aria-label={tr('清除筛选与排序')}
        onClick={onClear}
      >
        <Cross2Icon />
      </IconButton>
    </div>
  )
}
