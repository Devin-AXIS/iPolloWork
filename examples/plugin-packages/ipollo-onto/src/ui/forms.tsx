import type { EntityIconId } from '../core/icons'
import { translate as tr, useLocale } from './i18n'
import type { FieldSource } from '../core/sources'
import type { FieldDeletePreview } from '../core/field-management'
import { SourceConfig } from './fields/source-config'
import { DatabaseFields } from './database-fields'
import { ProjectFields } from './project-fields'
import type { DatabaseChoice } from '../core/database'
import { FieldTypePicker } from './fields/type-picker'
import { fieldEditors } from './fields/editor-registry'
import { fieldTypes } from '../core/fields'
import { ErrorNotice, FormLabel, Modal } from './components/primitives'
import { useState, type FormEvent } from 'react'
import { Button, TextField, Select, Switch, Tabs } from '@radix-ui/themes'
import { Link2Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import type { TableData, TableDef, FieldDef, Project } from '../core/contracts'
import { sourceUsesInput } from '../core/contracts'
import { api, message } from './api'

export function CreateDialog({
  kind,
  onClose,
  onCreate,
}: {
  kind: 'project' | 'table'
  onClose: () => void
  onCreate: (
    name: string,
    description: string,
    color: string,
    database?: DatabaseChoice,
    icon?: EntityIconId,
  ) => Promise<void>
}) {
  useLocale()
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [color, setColor] = useState('neutral')
  const [icon, setIcon] = useState<EntityIconId>(kind === 'project' ? 'folder' : 'table')
  const [tab, setTab] = useState('info')
  const [database, setDatabase] = useState<DatabaseChoice>({ mode: 'default' })
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onCreate(name.trim(), description.trim(), color, database, icon)
      onClose()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={kind === 'project' ? tr('创建项目') : tr('创建数据表')}
      description={
        kind === 'project'
          ? tr('从一个清晰的项目开始，组织你的数据与业务。')
          : tr('每张表管理一类信息，表之间可以建立关联。')
      }
      open
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        {kind === 'project' ? (
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List>
              <Tabs.Trigger value="info">{tr('项目信息')}</Tabs.Trigger>
              <Tabs.Trigger value="database">{tr('数据库')}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="info" className="project-tab-content form-stack">
              <ProjectFields
                icon={icon}
                onIcon={setIcon}
                name={name}
                description={description}
                color={color}
                onName={setName}
                onDescription={setDescription}
                onColor={setColor}
              />
              <button
                type="button"
                className="project-database-link"
                onClick={() => setTab('database')}
              >
                <span>{tr('项目数据库')}</span>
                <b>
                  {database.mode === 'default'
                    ? tr('默认数据库')
                    : database.connection.database || tr('配置独立数据库')}
                </b>
              </button>
            </Tabs.Content>
            <Tabs.Content value="database" className="project-tab-content">
              <DatabaseFields value={database} onChange={setDatabase} disabled={busy} />
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          <ProjectFields
            icon={icon}
            onIcon={setIcon}
            kind="table"
            name={name}
            description={description}
            color={color}
            onName={setName}
            onDescription={setDescription}
            onColor={setColor}
          />
        )}
        <ErrorNotice error={error} />
        <div className="form-actions">
          <Button type="button" variant="soft" color="gray" onClick={onClose}>
            {tr('取消')}
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={
              !name.trim() ||
              (database.mode === 'independent' &&
                (!database.connection.database.trim() ||
                  !database.connection.user.trim() ||
                  !database.connection.host.trim()))
            }
          >
            {kind === 'project' ? tr('创建项目') : tr('创建数据表')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function FieldDialog({
  field,
  data,
  tables,
  projects,
  onClose,
  onSaved,
}: {
  field?: FieldDef
  data: TableData
  tables: TableDef[]
  projects: Project[]
  onClose: () => void
  onSaved: (change?: { deletedFieldIds?: string[]; editedFieldId?: string }) => void
}) {
  useLocale()
  const [source, setSource] = useState<FieldSource | undefined>(field?.source ?? undefined)
  const [name, setName] = useState(field?.name ?? ''),
    [type, setType] = useState(field?.type ?? 'text'),
    [options, setOptions] = useState(field ? field.options.join(',') : tr('待跟进,进行中,已完成'))
  const [pluginOptions, setPluginOptions] = useState<Record<string, string[]>>({})
  const editor = fieldEditors.has(type) ? fieldEditors.get(type) : undefined
  const Configure = editor?.configure
  const configuredOptions =
    pluginOptions[type] ?? (field?.type === type ? field.options : (editor?.defaultOptions ?? []))
  const savedPluginOptions = configuredOptions.map((value) => value.trim()).filter(Boolean)
  const [target, setTarget] = useState(''),
    [reverseName, setReverseName] = useState(tr('{0}关联', { 0: data.table.name }))
  const [multiple, setMultiple] = useState(false),
    [inverseMultiple, setInverseMultiple] = useState(true),
    [required, setRequired] = useState(field?.required ?? false)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [deletion, setDeletion] = useState<FieldDeletePreview>()
  async function prepareDelete() {
    if (!field || busy) return
    setBusy(true)
    setError('')
    try {
      setDeletion(
        await api<FieldDeletePreview>(`/tables/${data.table.id}/fields/${field.id}/delete-preview`),
      )
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!field || !deletion || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ deletedFieldIds: string[] }>(
        `/tables/${data.table.id}/fields/${field.id}`,
        'DELETE',
        {
          tableVersion: deletion.tableVersion,
          relatedTableVersion: deletion.relatedTableVersion,
        },
      )
      onSaved(result)
      onClose()
    } catch (err) {
      setError(message(err))
      setDeletion(undefined)
    } finally {
      setBusy(false)
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (field) {
        await api(`/tables/${data.table.id}/fields/${field.id}`, 'PATCH', {
          tableVersion: data.table.version,
          name: name.trim(),
          type,
          required: type === 'relation' || source ? false : required,
          options: editor
            ? savedPluginOptions
            : ['select', 'multiselect'].includes(type)
              ? [
                  ...new Set(
                    options
                      .split(/[,，]/)
                      .map((v) => v.trim())
                      .filter(Boolean),
                  ),
                ]
              : field.options,
          source,
        })
      } else
        await api(`/tables/${data.table.id}/fields`, 'POST', {
          name: name.trim(),
          type,
          source: type === 'relation' ? undefined : source,
          required: type === 'relation' || source ? false : required,
          options: editor
            ? savedPluginOptions
            : ['select', 'multiselect'].includes(type)
              ? options
                  .split(/[,，]/)
                  .map((v) => v.trim())
                  .filter(Boolean)
              : [],
          ...(type === 'relation'
            ? { targetTableId: target, reverseName: reverseName.trim(), multiple, inverseMultiple }
            : {}),
        })
      const affectsQuery =
        field &&
        (type !== field.type ||
          (editor
            ? JSON.stringify(savedPluginOptions) !== JSON.stringify(field.options)
            : ['select', 'multiselect'].includes(type) && options !== field.options.join(',')) ||
          source?.storage !== field.source?.storage)
      onSaved(affectsQuery ? { editedFieldId: field.id } : undefined)
      onClose()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={deletion ? tr('删除字段') : field ? tr('编辑字段') : tr('添加字段')}
      description={
        deletion
          ? tr('请核对要删除的字段与引用。')
          : field
            ? tr('修改此字段的名称与取值设置。')
            : tr('选择普通字段、API 实时字段或关联记录。')
      }
      open
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {deletion ? (
        <div className="form-stack">
          <p className="form-hint">
            {deletion.relation
              ? tr('将删除两端的关联字段和 {0} 条连线，保留所有业务记录。', {
                  0: deletion.valueCount,
                })
              : tr('将删除此字段及其中的 {0} 个已保存值，其他字段和记录保留。', {
                  0: deletion.valueCount,
                })}
          </p>
          <ul className="field-delete-list">
            {deletion.fields.map((f) => (
              <li key={f.id}>
                {f.tableName} / <strong>{f.name}</strong>
              </li>
            ))}
          </ul>
          {deletion.blockers.length > 0 && (
            <div className="field-delete-blockers">
              <p>{tr('请先调整以下引用，再删除字段。')}</p>
              <ul className="field-delete-list">
                {deletion.blockers.map((b, i) => (
                  <li key={i}>
                    {tr(
                      (
                        {
                          primary: '记录名称字段',
                          api: 'API 字段',
                          view: '视图',
                          document: '文档',
                          automation: '自动化',
                        } as const
                      )[b.kind],
                    )}{' '}
                    · {b.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ErrorNotice error={error} />
          <div className="form-actions">
            <Button
              color="gray"
              variant="soft"
              disabled={busy}
              onClick={() => {
                setDeletion(undefined)
                setError('')
              }}
            >
              {tr('返回编辑')}
            </Button>
            <Button
              color="red"
              loading={busy}
              disabled={deletion.blockers.length > 0}
              onClick={remove}
            >
              {tr('确认删除字段')}
            </Button>
          </div>
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit}>
          <FormLabel label={tr('字段名称')}>
            <TextField.Root
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr('例如：负责人、预计金额')}
            />
          </FormLabel>
          {(!field || (!field.source && !field.relationId && !field.isPrimary)) && (
            <FormLabel label={tr('字段类型')}>
              <FieldTypePicker
                value={source ? 'api' : type}
                resultOnly={!!field}
                label={tr('字段类型')}
                onChange={(value) => {
                  if (value === 'api') {
                    setType('number')
                    setRequired(false)
                    setSource({
                      provider: 'json-api',
                      inputFieldId: '',
                      url: '',
                      valuePath: '/value',
                      observedAtPath: '',
                      ttlSeconds: 30,
                      unit: '',
                      storage: 'live',
                    })
                  } else {
                    setType(value)
                    setSource(undefined)
                  }
                }}
              />
            </FormLabel>
          )}
          {field && (field.source || field.relationId || field.isPrimary) && (
            <p className="form-hint">
              {field.isPrimary
                ? tr('记录名称用于识别与关联，可改名，保留文本类型。')
                : field.relationId
                  ? tr('关联两端共享数据，可分别修改字段名称。')
                  : tr('API 实时字段 ·') +
                    ' ' +
                    (fieldTypes.has(field.type)
                      ? tr(fieldTypes.get(field.type).label)
                      : tr('扩展未加载'))}
            </p>
          )}
          {source && !field && (
            <FormLabel label={tr('返回内容类型')}>
              <FieldTypePicker
                value={type}
                onChange={(value) => {
                  setType(value)
                  if (source.provider === 'json-api' && !['number', 'currency'].includes(value))
                    setSource({ ...source, decimalPlaces: undefined })
                  if (source.provider === 'tencent-stock')
                    setSource({
                      ...source,
                      metric:
                        value === 'date'
                          ? 'date'
                          : source.metric === 'date'
                            ? 'price'
                            : source.metric,
                      unit: value === 'date' ? '' : source.metric === 'volume' ? tr('股') : 'USD',
                    })
                }}
                resultOnly
                allowedTypes={
                  source.provider === 'tencent-stock' ? ['number', 'currency', 'date'] : undefined
                }
              />
            </FormLabel>
          )}
          {source && (
            <SourceConfig
              source={source}
              valueType={type}
              fields={data.fields}
              onChange={setSource}
            />
          )}
          {!source && Configure && (
            <Configure
              options={configuredOptions}
              onChange={(next) => setPluginOptions((old) => ({ ...old, [type]: next }))}
            />
          )}
          {!source && !editor && ['select', 'multiselect'].includes(type) && (
            <FormLabel label={tr('选项，以逗号分隔')}>
              <TextField.Root value={options} onChange={(e) => setOptions(e.target.value)} />
            </FormLabel>
          )}
          {type === 'relation' ? (
            !field && (
              <div className="relation-config">
                <div className="section-caption">
                  <Link2Icon />
                  {tr('建立双向关联')}
                </div>
                <FormLabel label={tr('目标数据表')}>
                  <Select.Root value={target} onValueChange={setTarget}>
                    <Select.Trigger placeholder={tr('选择数据表')} aria-label={tr('目标数据表')} />
                    <Select.Content>
                      {tables.map((t) => (
                        <Select.Item value={t.id} key={t.id}>
                          {projects.find((p) => p.id === t.projectId)?.name ?? tr('项目')} /{' '}
                          {t.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </FormLabel>
                <FormLabel label={tr('对方表中的字段名称')}>
                  <TextField.Root
                    value={reverseName}
                    maxLength={80}
                    onChange={(e) => setReverseName(e.target.value)}
                  />
                </FormLabel>
                <label className="switch-row">
                  <span>{tr('本表每条记录可关联多个目标')}</span>
                  <Switch
                    checked={multiple}
                    onCheckedChange={setMultiple}
                    aria-label={tr('允许关联多个目标')}
                  />
                </label>
                <label className="switch-row">
                  <span>{tr('目标记录可被本表多条记录引用')}</span>
                  <Switch
                    checked={inverseMultiple}
                    onCheckedChange={setInverseMultiple}
                    aria-label={tr('允许多个来源引用')}
                  />
                </label>
                <p className="form-hint">{tr('两端共享同一条关系，可从任意一端调整。')}</p>
              </div>
            )
          ) : !source ? (
            <label className="switch-row">
              <span>{tr('必填字段')}</span>
              <Switch
                checked={required}
                onCheckedChange={setRequired}
                aria-label={tr('必填字段')}
              />
            </label>
          ) : null}
          <ErrorNotice error={error} />
          <div className="form-actions">
            {field && !field.isPrimary && (
              <Button
                type="button"
                color="red"
                variant="ghost"
                className="field-delete-action"
                disabled={busy}
                onClick={prepareDelete}
              >
                <TrashIcon />
                {tr('删除字段')}
              </Button>
            )}
            <Button type="button" color="gray" variant="soft" disabled={busy} onClick={onClose}>
              {tr('取消')}
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={
                !name.trim() ||
                (!field && type === 'relation' && (!target || !reverseName.trim())) ||
                Boolean(source && sourceUsesInput(source) && !source.inputFieldId)
              }
            >
              {!field && <PlusIcon />}
              {field ? tr('保存') : tr('添加字段')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
