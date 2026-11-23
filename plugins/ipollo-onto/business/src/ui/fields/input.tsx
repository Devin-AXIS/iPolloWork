import { translate as tr, useLocale } from '../i18n'
import { lazy, Suspense, useEffect, useState } from 'react'
import { TextField, TextArea, Switch } from '@radix-ui/themes'
import type { LinkValue } from '../../core/contracts'
import { display } from '../../core/contracts'
import { fieldTypes } from '../../core/fields'
import { api, message } from '../api'
import { fieldEditors } from './editor-registry'
import {
  ChoiceInput,
  NumberInput,
  RatingInput,
  ReferenceInput,
  SelectInput,
  TagInput,
  type ValueInputProps,
} from './input-controls'
const TemporalInput = lazy(() =>
  import('./temporal-input').then((module) => ({ default: module.TemporalInput })),
)

type Props = ValueInputProps & { selectedLinks?: LinkValue[] }

function RelationInput({ field, value, onChange, selectedLinks = [] }: Props) {
  const [choices, setChoices] = useState<LinkValue[]>([]),
    [known, setKnown] = useState<LinkValue[]>([])
  const [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setChoices([])
    setError('')
    const timer = setTimeout(() => {
      api<LinkValue[]>(`/tables/${field.targetTableId}/options?q=${encodeURIComponent(query)}`)
        .then((next) => {
          if (active) {
            setChoices(next)
            setKnown((old) => [...new Map([...old, ...next].map((v) => [v.id, v])).values()])
          }
        })
        .catch((e) => {
          if (active) {
            setChoices([])
            setError(message(e))
          }
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [field.targetTableId, query])
  return (
    <ChoiceInput
      field={field}
      value={value}
      onChange={onChange}
      choices={choices}
      selectedLabels={[...selectedLinks, ...known]}
      query={query}
      onQuery={setQuery}
      loading={loading}
      error={error}
    />
  )
}

// All editing surfaces use this adapter. Controls emit values; callers own drafts and persistence.
export function FieldInput(props: Props) {
  useLocale()
  const { field, value, onChange } = props
  if (field.type === 'relation') return <RelationInput key={field.id} {...props} />
  if (!fieldTypes.has(field.type))
    return (
      <TextField.Root
        id={field.id}
        aria-label={field.name}
        readOnly
        value={display(value)}
        title={tr('扩展未加载，暂时不可编辑')}
      />
    )
  const definition = fieldTypes.get(field.type)
  if (fieldEditors.has(field.type)) {
    const Editor = fieldEditors.get(field.type).component
    return <Editor key={field.id} {...props} />
  }
  if (field.type === 'rating') return <RatingInput {...props} />
  if (['url', 'image', 'file'].includes(field.type)) return <ReferenceInput {...props} />
  switch (definition.input) {
    case 'date':
    case 'time':
    case 'datetime':
    case 'daterange':
      return (
        <Suspense fallback={<span className="form-hint">{tr('正在加载…')}</span>}>
          <TemporalInput key={field.id} {...props} kind={definition.input} />
        </Suspense>
      )
    case 'number':
      return <NumberInput {...props} />
    case 'multiselect':
      return <ChoiceInput {...props} choices={field.options.map((v) => ({ id: v, label: v }))} />
    case 'tags':
      return <TagInput {...props} />
    case 'select':
      return <SelectInput {...props} />
    case 'checkbox':
      return (
        <Switch
          id={field.id}
          aria-label={field.name}
          checked={Boolean(value)}
          onCheckedChange={onChange}
        />
      )
    case 'textarea':
    case 'json':
      return (
        <TextArea
          id={field.id}
          aria-label={field.name}
          rows={definition.input === 'json' ? 5 : 3}
          className={definition.input === 'json' ? 'field-json-input' : undefined}
          value={display(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={definition.input === 'json' ? '{ "key": "value" }' : tr('输入内容')}
        />
      )
    default:
      return (
        <TextField.Root
          id={field.id}
          aria-label={field.name}
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
          required={field.required}
          value={display(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={tr('填写{0}', { 0: field.name })}
        />
      )
  }
}
