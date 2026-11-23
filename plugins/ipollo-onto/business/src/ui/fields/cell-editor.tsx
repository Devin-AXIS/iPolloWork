import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Popover } from '@radix-ui/themes'
import { CheckIcon, Cross2Icon } from '@radix-ui/react-icons'
import { links } from '../../core/contracts'
import type { DataRecord, FieldDef } from '../../core/contracts'
import { api, message } from '../api'
import { translate as tr } from '../i18n'
import { ErrorNotice } from '../components/primitives'
import { FieldInput } from './input'
import { fieldDraft } from './record-draft'
import { fieldEditors } from './editor-registry'

export function CellEditor({
  field,
  record,
  children,
  onSaved,
  onEditingChange,
}: {
  field: FieldDef
  record: DataRecord
  children: ReactNode
  onSaved?: () => void
  onEditingChange?: (editing: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<unknown>()
  const [version, setVersion] = useState(record.version)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLDivElement>(null)
  const callback = useRef(onEditingChange)
  callback.current = onEditingChange
  useEffect(() => () => callback.current?.(false), [])
  function changeOpen(next: boolean) {
    if (busy) return
    if (next) {
      setValue(fieldDraft(field, record))
      setVersion(record.version)
      setDirty(false)
      setError('')
    }
    setOpen(next)
    onEditingChange?.(next)
  }
  async function save() {
    if (busy) return
    if (!dirty) {
      changeOpen(false)
      return
    }
    setBusy(true)
    setError('')
    try {
      await api(`/tables/${field.tableId}/records/${record.id}`, 'PATCH', {
        version,
        values: { [field.id]: value },
      })
      setOpen(false)
      onEditingChange?.(false)
      onSaved?.()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={changeOpen} modal>
      <Popover.Trigger>
        <button
          className="record-open cell-edit-trigger"
          aria-label={tr('编辑单元格 {0}', { 0: field.name })}
        >
          {children}
        </button>
      </Popover.Trigger>
      <Popover.Content
        className="cell-editor"
        side="bottom"
        align="start"
        sideOffset={-44}
        sticky="always"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          const element = input.current?.querySelector<HTMLElement>('input, textarea, button')
          element?.focus()
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
            element.select()
        }}
        onInteractOutside={(e) => {
          if (dirty || busy) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.defaultPrevented) return
            // Native select/date/checkbox and relation controls keep their own Enter behavior.
            if (
              e.key === 'Enter' &&
              (e.ctrlKey ||
                e.metaKey ||
                (e.target instanceof HTMLInputElement &&
                  !['checkbox', 'radio', 'date', 'time', 'datetime-local'].includes(
                    e.target.type,
                  ) &&
                  !e.target.closest('[data-field-enter="control"]') &&
                  field.type !== 'relation'))
            ) {
              e.preventDefault()
              void save()
            }
          }}
        >
          <fieldset disabled={busy}>
            <div className="cell-editor-input" ref={input} role="group" aria-label={field.name}>
              <label className="sr-only" htmlFor={field.id}>
                {field.name}
              </label>
              <FieldInput
                field={field}
                value={value}
                selectedLinks={links(record.values[field.id])}
                onChange={(next) => {
                  setValue(next)
                  setDirty(true)
                }}
              />
            </div>
          </fieldset>
          <ErrorNotice error={error} />
          <div className="cell-editor-actions">
            <span>
              {fieldEditors.has(field.type) ||
              [
                'longtext',
                'json',
                'relation',
                'tags',
                'multiselect',
                'select',
                'date',
                'datetime',
                'time',
                'daterange',
                'rating',
                'progress',
              ].includes(field.type)
                ? tr('Ctrl / ⌘ + Enter 保存')
                : tr('Enter 保存 · Esc 取消')}
            </span>
            <Button
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              disabled={busy}
              aria-label={tr('取消编辑')}
              onClick={() => changeOpen(false)}
            >
              <Cross2Icon />
            </Button>
            <Button type="submit" size="1" loading={busy} aria-label={tr('保存单元格')}>
              <CheckIcon />
            </Button>
          </div>
        </form>
      </Popover.Content>
    </Popover.Root>
  )
}
