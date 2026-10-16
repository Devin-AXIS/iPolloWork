import { useId, useState, type CSSProperties } from 'react'
import { Button, Checkbox, IconButton, Popover, Select, TextField } from '@radix-ui/themes'
import {
  ChevronDownIcon,
  Cross2Icon,
  StarIcon,
  StarFilledIcon,
  ImageIcon,
  FileIcon,
  ExternalLinkIcon,
  MagnifyingGlassIcon,
  Link2Icon,
} from '@radix-ui/react-icons'
import type { FieldDef } from '../../core/contracts'
import { display } from '../../core/contracts'
import { fieldTypes } from '../../core/fields'
import { translate as tr } from '../i18n'
import { referenceUrl, tagParts, tagValue } from './input-values'

export interface ValueInputProps {
  field: FieldDef
  value: unknown
  onChange: (value: unknown) => void
}
export function ChoiceInput({
  field,
  value,
  onChange,
  choices,
  selectedLabels = [],
  query,
  onQuery,
  loading,
  error,
}: ValueInputProps & {
  choices: Array<{ id: string; label: string }>
  selectedLabels?: Array<{ id: string; label: string }>
  query?: string
  onQuery?: (query: string) => void
  loading?: boolean
  error?: string
}) {
  const [search, setSearch] = useState(''),
    [open, setOpen] = useState(false)
  const selected = Array.isArray(value) ? (value as string[]) : []
  const multiple = field.type !== 'relation' || field.multiple
  const options = onQuery
    ? choices
    : choices.filter((c) => c.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button
          type="button"
          id={field.id}
          variant="surface"
          color="gray"
          className="field-picker-trigger"
          data-empty={!selected.length}
          aria-label={field.name}
        >
          <span className="field-picker-summary">
            {selected.length
              ? selected
                  .map(
                    (id) =>
                      [...choices, ...selectedLabels].find((c) => c.id === id)?.label ??
                      tr('已选记录'),
                  )
                  .join('、')
              : tr('请选择')}
          </span>
          <ChevronDownIcon />
        </Button>
      </Popover.Trigger>
      <Popover.Content
        className="field-choice-popover"
        align="start"
        sideOffset={6}
        collisionPadding={12}
      >
        <TextField.Root
          aria-label={tr('搜索选项')}
          placeholder={tr('搜索选项')}
          value={query ?? search}
          maxLength={80}
          onChange={(e) => (onQuery ?? setSearch)(e.target.value)}
          data-field-enter="control"
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
        <div className="field-choice-list" aria-label={field.name} aria-busy={loading}>
          {options.map((option) => (
            <label key={option.id} data-selected={selected.includes(option.id)}>
              <Checkbox
                aria-label={option.label}
                checked={selected.includes(option.id)}
                onCheckedChange={(checked) => {
                  onChange(
                    checked
                      ? multiple
                        ? [...selected, option.id]
                        : [option.id]
                      : selected.filter((id) => id !== option.id),
                  )
                  if (!multiple) setOpen(false)
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
          {!options.length && (
            <span className="form-hint">
              {loading ? tr('正在加载…') : error || tr('没有匹配的选项')}
            </span>
          )}
        </div>
        {error && options.length > 0 && (
          <span className="form-hint" role="alert">
            {error}
          </span>
        )}
        <div className="field-input-footer">
          <span>{tr('已选 {0} 项', { 0: selected.length })}</span>
          <Button
            type="button"
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => onChange([])}
            disabled={!selected.length}
          >
            {tr('清空选择')}
          </Button>
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
export function SelectInput({ field, value, onChange }: ValueInputProps) {
  const index = field.options.indexOf(display(value))
  return (
    <Select.Root
      value={index < 0 ? 'empty' : String(index)}
      onValueChange={(v) => onChange(v === 'empty' ? '' : field.options[Number(v)])}
    >
      <Select.Trigger id={field.id} aria-label={field.name} placeholder={tr('请选择')} />
      <Select.Content position="popper" sideOffset={6} collisionPadding={12}>
        <Select.Item value="empty">{tr('未选择')}</Select.Item>
        {field.options.map((option, i) => (
          <Select.Item key={option} value={String(i)}>
            {option}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  )
}
export function TagInput({ field, value, onChange }: ValueInputProps) {
  const { tags, draft } = tagParts(value)
  return (
    <div className="field-tags" role="group" aria-label={field.name}>
      {tags.map((tag) => (
        <span className="field-tag" key={tag}>
          <span>{tag}</span>
          <button
            type="button"
            aria-label={tr('移除 {0}', { 0: tag })}
            onClick={() =>
              onChange(
                tagValue(
                  tags.filter((v) => v !== tag),
                  draft,
                ),
              )
            }
          >
            <Cross2Icon />
          </button>
        </span>
      ))}
      <input
        id={field.id}
        aria-label={field.name}
        value={draft}
        placeholder={tags.length ? tr('继续添加') : tr('输入标签，按 Enter 添加')}
        maxLength={8099}
        onChange={(e) => onChange(tagValue(tags, e.target.value))}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey) return
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            if (draft.trim()) onChange([...new Set([...tags, draft.trim()])])
          }
          if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
        }}
      />
    </div>
  )
}
export function NumberInput({ field, value, onChange }: ValueInputProps) {
  const percent = ['percentage', 'progress'].includes(field.type)
  const input = (
    <TextField.Root
      id={field.id}
      aria-label={field.name}
      inputMode="decimal"
      type={field.type === 'currency' ? 'text' : 'number'}
      step="any"
      min={percent ? 0 : undefined}
      max={percent ? 100 : undefined}
      required={field.required}
      value={display(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.type === 'currency' ? '0.00' : percent ? '0–100' : tr('输入数字')}
    >
      {percent && <TextField.Slot side="right">%</TextField.Slot>}
    </TextField.Root>
  )
  return (
    <div
      className={`field-number-input ${field.type === 'progress' ? 'field-progress-input' : ''}`}
    >
      {field.type === 'progress' && (
        <input
          type="range"
          min={0}
          max={100}
          step="1"
          style={
            {
              '--field-progress': `${Math.max(0, Math.min(100, Number(value) || 0))}%`,
            } as CSSProperties
          }
          aria-label={field.name}
          value={Math.max(0, Math.min(100, Number(value) || 0))}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {input}
      {field.type === 'currency' &&
        value != null &&
        value !== '' &&
        fieldTypes.get('currency').format(value) !== display(value) &&
        /^-?\d+(\.\d*)?$/.test(String(value)) && (
          <span className="field-number-preview" aria-label={tr('金额预览')}>
            {fieldTypes.get('currency').format(value)}
          </span>
        )}
    </div>
  )
}
export function RatingInput({ field, value, onChange }: ValueInputProps) {
  const name = useId(),
    rating = value === '' || value == null ? -1 : Number(value)
  return (
    <div className="field-rating" role="radiogroup" aria-label={field.name}>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <label key={n} data-filled={n <= rating}>
          <input
            type="radio"
            name={name}
            checked={n === rating}
            aria-label={tr('{0}：{1} 星', { 0: field.name, 1: n })}
            onChange={() => onChange(String(n))}
          />
          <span>{n === 0 ? '0' : n <= rating ? <StarFilledIcon /> : <StarIcon />}</span>
        </label>
      ))}
      <IconButton
        type="button"
        size="1"
        color="gray"
        variant="ghost"
        disabled={rating < 0}
        aria-label={tr('清除 {0}', { 0: field.name })}
        onClick={() => onChange('')}
      >
        <Cross2Icon />
      </IconButton>
    </div>
  )
}
export function ReferenceInput({ field, value, onChange }: ValueInputProps) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const url = referenceUrl(value),
    image = field.type === 'image'
  return (
    <div className="field-reference-input">
      <TextField.Root
        id={field.id}
        aria-label={field.name}
        type="url"
        value={display(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          image ? tr('粘贴图片链接') : field.type === 'file' ? tr('粘贴文件链接') : 'https://'
        }
      >
        <TextField.Slot>
          {image ? <ImageIcon /> : field.type === 'file' ? <FileIcon /> : <Link2Icon />}
        </TextField.Slot>
        {url && (
          <TextField.Slot side="right">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={tr('打开 {0}', { 0: field.name })}
            >
              <ExternalLinkIcon />
            </a>
          </TextField.Slot>
        )}
      </TextField.Root>
      {image && url && (
        <div className="field-image-preview">
          {failedUrl === url ? (
            <span className="form-hint">{tr('图片暂时无法预览')}</span>
          ) : (
            <img
              src={url}
              alt={field.name}
              referrerPolicy="no-referrer"
              onError={() => setFailedUrl(url)}
            />
          )}
          <IconButton
            type="button"
            size="1"
            color="gray"
            variant="surface"
            aria-label={tr('移除图片')}
            onClick={() => onChange('')}
          >
            <Cross2Icon />
          </IconButton>
        </div>
      )}
    </div>
  )
}
