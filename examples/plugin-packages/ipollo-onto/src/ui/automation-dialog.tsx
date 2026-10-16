import { translate as tr, useLocale } from './i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, TextField, Select, Switch, Badge } from '@radix-ui/themes'
import type { TableData } from '../core/contracts'
import { FieldInput } from './fields/input'
import { Modal, FormLabel, ErrorNotice } from './components/primitives'
import { useExtensions } from './extension-context'
import { api, message } from './api'

interface Rule {
  id: string
  name: string
  fieldId: string
  enabled: boolean
  lastStatus: string | null
  lastError: string | null
}
export function AutomationDialog({ data, onClose }: { data: TableData; onClose: () => void }) {
  useLocale()
  const { extensions, change } = useExtensions(),
    enabled = extensions.some((e) => e.id === 'automation' && e.enabled)
  const fields = data.fields.filter((f) => f.type !== 'relation' && !f.source)
  const [rules, setRules] = useState<Rule[]>([]),
    [fieldId, setFieldId] = useState(fields[0]?.id ?? ''),
    [value, setValue] = useState<unknown>('')
  const [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const field = fields.find((f) => f.id === fieldId)
  const endpoint = `/tables/${data.table.id}/automations`
  useEffect(() => {
    let active = true
    const load = () =>
      api<Rule[]>(endpoint)
        .then((r) => {
          if (active) setRules(r)
        })
        .catch((e) => {
          if (active) setError(message(e))
        })
    void load()
    const timer = setInterval(load, 2500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [endpoint])
  async function work(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      setRules(await api<Rule[]>(endpoint))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    await work(async () => {
      await api(endpoint, 'POST', {
        name: name.trim() || tr('自动填写{0}', { 0: field?.name }),
        fieldId,
        value,
      })
      setName('')
      setValue('')
    })
  }
  return (
    <Modal
      title={tr('自动化')}
      description={tr('{0} · 新记录创建后自动填写空字段，保留已填写的内容。', {
        0: data.table.name,
      })}
      open
      onClose={onClose}
      wide
    >
      <ErrorNotice error={error} />
      {!enabled ? (
        <div className="form-stack">
          <p>{tr('启用轻量自动化后，规则会由本地服务在后台运行。')}</p>
          <Button
            disabled={busy}
            onClick={() =>
              work(() =>
                change(
                  'automation',
                  extensions.find((e) => e.id === 'automation')?.installedVersion
                    ? 'enable'
                    : 'install',
                ),
              )
            }
          >
            {tr('启用自动化')}
          </Button>
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit}>
          <FormLabel label={tr('规则名称')}>
            <TextField.Root
              maxLength={80}
              placeholder={tr('例如：新客户默认待跟进')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormLabel>
          <FormLabel label={tr('自动填写的字段')}>
            <Select.Root
              value={fieldId}
              onValueChange={(v) => {
                setFieldId(v)
                setValue('')
              }}
            >
              <Select.Trigger aria-label={tr('自动填写的字段')} />
              <Select.Content>
                {fields.map((f) => (
                  <Select.Item key={f.id} value={f.id}>
                    {f.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </FormLabel>
          {field ? (
            <div className="form-label">
              <label htmlFor={field.id}>{tr('填入的值')}</label>
              <FieldInput field={field} value={value} onChange={setValue} />
            </div>
          ) : null}
          <div className="form-actions">
            <Button type="submit" loading={busy} disabled={!field}>
              {tr('添加规则')}
            </Button>
          </div>
        </form>
      )}
      <div className="automation-list">
        {rules.map((r) => (
          <div key={r.id}>
            <div>
              <b>{r.name}</b>
              <p>
                {r.lastError ??
                  (r.lastStatus === 'completed'
                    ? tr('已执行')
                    : r.lastStatus === 'skipped'
                      ? tr('已保留现有值')
                      : tr('等待新记录'))}
              </p>
            </div>
            <Badge color="gray">{r.enabled ? tr('启用') : tr('暂停')}</Badge>
            <Switch
              aria-label={tr('启用{0}', { 0: r.name })}
              checked={r.enabled}
              disabled={busy || (!enabled && !r.enabled)}
              onCheckedChange={(v) =>
                work(() => api(`${endpoint}/${r.id}`, 'PATCH', { enabled: v }))
              }
            />
            <Button
              size="1"
              variant="ghost"
              color="gray"
              disabled={busy}
              onClick={() => work(() => api(`${endpoint}/${r.id}`, 'DELETE'))}
            >
              {tr('移除')}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
