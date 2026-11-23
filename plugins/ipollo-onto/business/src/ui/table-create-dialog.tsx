import { useId, useRef, useState, type FormEvent } from 'react'
import { Button, Select } from '@radix-ui/themes'
import { tablePresets, type TablePresetId, type TablePresetInput } from '../core/table-presets'
import type { BlueprintResult } from '../core/blueprint'
import type { TableDef } from '../core/contracts'
import type { EntityIconId } from '../core/icons'
import { api, message } from './api'
import { translate as tr, useLocale } from './i18n'
import { ProjectFields } from './project-fields'
import { EntityIcon, FieldTypeIcon } from './components/icons'
import { ErrorNotice, FormLabel, Modal } from './components/primitives'

export function TableCreateDialog({
  projectId,
  tables,
  onClose,
  onCreated,
}: {
  projectId: string
  tables: TableDef[]
  onClose: () => void
  onCreated: (result: BlueprintResult) => void
}) {
  const locale = useLocale()
  const presets = tablePresets(locale)
  const [preset, setPreset] = useState<TablePresetId>('general')
  const selected = presets.find((p) => p.id === preset)!
  const [name, setName] = useState(''),
    [description, setDescription] = useState('')
  const [icon, setIcon] = useState<EntityIconId>('table')
  const [bindings, setBindings] = useState({ users: '', products: '' })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const receipt = useRef<{ body: string; requestId: string } | null>(null)
  const radioName = useId()
  function choose(id: TablePresetId) {
    const next = presets.find((p) => p.id === id)!
    if (!name.trim() || name === selected.name) setName(id === 'general' ? '' : next.name)
    if (icon === selected.icon) setIcon(next.icon)
    setPreset(id)
    setError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const targets: TablePresetInput['bindings'] = {}
      if (preset === 'orders')
        for (const role of ['users', 'products'] as const) {
          if (!bindings[role]) continue
          const table = tables.find((table) => table.id === bindings[role])
          if (!table) throw new Error(tr('关联表已变化，请重新选择'))
          targets[role] = { tableId: table.id, version: table.version }
        }
      const options = {
        preset,
        locale,
        name: name.trim(),
        description: description.trim(),
        icon,
        bindings: targets,
      }
      const body = JSON.stringify(options)
      if (receipt.current?.body !== body) receipt.current = { body, requestId: crypto.randomUUID() }
      const input = { ...options, requestId: receipt.current.requestId }
      const path = `/projects/${projectId}/operations/table_preset_`
      await api<BlueprintResult>(`${path}preview`, 'POST', input)
      const result = await api<BlueprintResult>(`${path}apply`, 'POST', input)
      onCreated(result)
      onClose()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  const createdCount =
    preset === 'orders' ? 1 + Number(!bindings.users) + Number(!bindings.products) : 1
  return (
    <Modal
      title={tr('创建数据表')}
      description={tr('选择起点，创建后可继续添加字段和关联。')}
      open
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        <fieldset className="table-preset-picker" disabled={busy}>
          <legend className="sr-only">{tr('建表类型')}</legend>
          {presets.map((item) => (
            <label key={item.id} className="table-preset-choice">
              <input
                type="radio"
                name={radioName}
                value={item.id}
                checked={preset === item.id}
                onChange={() => choose(item.id)}
              />
              <span>
                <EntityIcon name={item.icon} />
                {item.name}
              </span>
            </label>
          ))}
        </fieldset>
        <p className="table-preset-description">{selected.description}</p>
        <fieldset className="table-preset-form form-stack" disabled={busy}>
          <ProjectFields
            kind="table"
            compact
            name={name}
            onName={setName}
            description={description}
            onDescription={setDescription}
            icon={icon}
            onIcon={setIcon}
            color="neutral"
            onColor={() => {}}
          />
          {preset !== 'general' && (
            <div className="table-preset-fields" aria-label={tr('预设字段')}>
              {selected.fields.map((field) => (
                <span key={field.key}>
                  <FieldTypeIcon type={field.type} />
                  {field.name}
                </span>
              ))}
            </div>
          )}
          {preset === 'orders' && (
            <div className="table-preset-bindings">
              {(['users', 'products'] as const).map((role) => (
                <FormLabel
                  key={role}
                  label={role === 'users' ? tr('关联用户表') : tr('关联商品表')}
                >
                  <Select.Root
                    value={bindings[role] || 'new'}
                    disabled={busy}
                    onValueChange={(value) =>
                      setBindings((current) => ({
                        ...current,
                        [role]: value === 'new' ? '' : value,
                      }))
                    }
                  >
                    <Select.Trigger
                      aria-label={role === 'users' ? tr('关联用户表') : tr('关联商品表')}
                    />
                    <Select.Content position="popper">
                      <Select.Item value="new">
                        {role === 'users' ? tr('新建用户表') : tr('新建商品表')}
                      </Select.Item>
                      {tables.length > 0 && <Select.Separator />}
                      {tables.map((table) => (
                        <Select.Item key={table.id} value={table.id}>
                          {table.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </FormLabel>
              ))}
              <p className="form-hint">
                {tr('直接关联用户和商品。选择已有表可复用；未选择的表会一起新建。')}
              </p>
            </div>
          )}
        </fieldset>
        <ErrorNotice error={error} />
        <div className="table-preset-footer">
          <small>{tr('将创建 {0} 张表', { 0: createdCount })}</small>
          <div className="form-actions">
            <Button type="button" color="gray" variant="soft" disabled={busy} onClick={onClose}>
              {tr('取消')}
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              {tr('创建数据表')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
