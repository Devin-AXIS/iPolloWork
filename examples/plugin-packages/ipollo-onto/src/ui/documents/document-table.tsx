import { useContext, useEffect, useRef, useState } from 'react'
import { Button, Select } from '@radix-ui/themes'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Pencil1Icon,
  PlusIcon,
  TableIcon,
  CheckIcon,
} from '@radix-ui/react-icons'
import type { FieldDef, Project, TableData, TableDef } from '../../core/contracts'
import type { TableEmbed } from '../../core/documents'
import type { QueryContext } from '../../core/query'
import { api, message } from '../api'
import { translate as tr, useLocale } from '../i18n'
import { ErrorNotice, LoadingState } from '../components/primitives'
import GridView from '../grid-view'
import { FieldDialog } from '../forms'
import { DocumentTableActions } from './document-table-actions'

type EmbeddedData = TableData & { createValues?: Record<string, unknown> }
export function DocumentTable({
  base,
  config,
  onOpen,
}: {
  base: string
  config: TableEmbed
  onOpen?: (tableId: string, recordId: string) => void
}) {
  useLocale()
  const actions = useContext(DocumentTableActions)
  const referenceRevision = actions?.revision
  const [page, setPage] = useState(1)
  const [data, setData] = useState<EmbeddedData>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [cellEditing, setCellEditing] = useState(false)
  const [fieldDialog, setFieldDialog] = useState<{
    field?: FieldDef
    tables: TableDef[]
    projects: Project[]
  }>()
  const openingField = useRef(false)
  const key = JSON.stringify(config)
  useEffect(() => {
    setPage(1)
    setData(undefined)
  }, [base, key])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api<EmbeddedData>(`${base}/table`, 'POST', { config: JSON.parse(key), page, interactive: true })
      .then((value) => {
        if (!active) return
        const last = Math.max(1, Math.ceil(value.total / value.pageSize))
        if (page > last) setPage(last)
        else setData(value)
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [base, key, page, revision, referenceRevision])
  function changed() {
    setRevision((v) => v + 1)
    actions?.onChanged()
  }
  async function openField(field?: FieldDef) {
    if (!data || openingField.current) return
    openingField.current = true
    setError('')
    try {
      const [tables, projects] = await Promise.all([
        api<TableDef[]>(`/tables?projectId=${data.table.projectId}`),
        api<Project[]>('/projects'),
      ])
      setFieldDialog({
        field,
        tables,
        projects: projects.filter((p) => p.id === data.table.projectId),
      })
    } catch (e) {
      setError(message(e))
    } finally {
      openingField.current = false
    }
  }
  async function reorderFields(ids: string[]) {
    if (!data) return
    setError('')
    try {
      const result = await api<Pick<TableData, 'table' | 'fields'>>(
        `/tables/${data.table.id}/fields/order`,
        'PATCH',
        { ids, version: data.table.version },
      )
      setData((current) => current && { ...current, ...result })
      actions?.onChanged()
    } catch (e) {
      setError(message(e))
      setRevision((v) => v + 1)
    }
  }
  return (
    <section className="document-table" aria-label={tr('引用表格')}>
      <header>
        <TableIcon />
        <strong>{data?.table.name ?? tr('引用表格')}</strong>
        {data && (
          <span className="document-table-count">{tr('{0} 条记录', { 0: data.total })}</span>
        )}
        <div className="document-table-actions">
          <Button
            size="1"
            variant={editMode ? 'soft' : 'ghost'}
            color="gray"
            disabled={!data || cellEditing}
            aria-pressed={editMode}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? <CheckIcon /> : <Pencil1Icon />}
            {tr(editMode ? '完成' : '编辑')}
          </Button>
          <Button
            size="1"
            variant="ghost"
            color="gray"
            disabled={!data || cellEditing}
            onClick={() => void openField()}
          >
            <PlusIcon />
            {tr('添加字段')}
          </Button>
        </div>
      </header>
      <ErrorNotice error={error} />
      {!data && loading ? (
        <LoadingState>{tr('正在加载…')}</LoadingState>
      ) : (
        data && (
          <>
            <div aria-busy={loading}>
              <GridView
                data={data}
                editMode={editMode}
                onOpen={(record) => onOpen?.(data.table.id, record.id)}
                onAdd={() => actions?.onCreate(data, data.createValues ?? {})}
                onAddField={() => void openField()}
                onEditField={(field) => void openField(field)}
                onReorderFields={reorderFields}
                onCellEditingChange={setCellEditing}
                onCellSaved={changed}
              />
            </div>
            {data.total > data.pageSize && (
              <footer>
                <span>{tr('{0} 条记录', { 0: data.total })}</span>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  disabled={page === 1 || loading || cellEditing}
                  aria-label={tr('上一页')}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeftIcon />
                </Button>
                <span>{page}</span>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  disabled={page * data.pageSize >= data.total || loading || cellEditing}
                  aria-label={tr('下一页')}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRightIcon />
                </Button>
              </footer>
            )}
          </>
        )
      )}
      {fieldDialog && data && (
        <FieldDialog
          {...fieldDialog}
          data={data}
          onClose={() => setFieldDialog(undefined)}
          onSaved={changed}
        />
      )}
    </section>
  )
}
export function TableReferencePicker({
  projectId,
  tableId,
  recordId,
  relations,
  onPick,
}: {
  projectId: string
  tableId: string
  recordId: string
  relations: TableData['fields']
  onPick: (config: TableEmbed) => void
}) {
  const [tables, setTables] = useState<TableDef[]>([]),
    [selected, setSelected] = useState(tableId),
    [view, setView] = useState('all'),
    [context, setContext] = useState<QueryContext>(),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api<TableDef[]>(`/tables?projectId=${projectId}`)
      .then((v) => {
        if (active) setTables(v)
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [projectId])
  useEffect(() => {
    let active = true
    setView('all')
    setContext(undefined)
    api<QueryContext>(`/tables/${selected}/query-context`)
      .then((v) => {
        if (active) setContext(v)
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [selected])
  return (
    <div className="document-picker">
      <strong>{tr('引用表格')}</strong>
      <Select.Root value={selected} onValueChange={setSelected}>
        <Select.Trigger aria-label={tr('选择数据表')} />
        <Select.Content data-document-menu-portal>
          {tables.map((t) => (
            <Select.Item key={t.id} value={t.id}>
              {t.name}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Select.Root value={view} onValueChange={setView}>
        <Select.Trigger aria-label={tr('显示内容')} />
        <Select.Content data-document-menu-portal>
          <Select.Item value="all">{tr('全部记录')}</Select.Item>
          {selected === tableId && <Select.Item value="record">{tr('当前记录')}</Select.Item>}
          {context?.views.map((v) => (
            <Select.Item value={v.id} key={v.id}>
              {v.name}
            </Select.Item>
          ))}
          {selected === tableId &&
            relations
              .filter((f) => f.type === 'relation' && tables.some((t) => t.id === f.targetTableId))
              .map((f) => (
                <Select.Item value={`relation:${f.id}`} key={f.id}>
                  {tr('关联：{0}', { 0: f.name })}
                </Select.Item>
              ))}
        </Select.Content>
      </Select.Root>
      <ErrorNotice error={error} />
      <Button
        onClick={() =>
          onPick({
            tableId: selected,
            ...(view === 'record'
              ? { recordId }
              : view.startsWith('relation:')
                ? { recordId, relationFieldId: view.slice(9) }
                : view === 'all'
                  ? {}
                  : { viewId: view }),
          })
        }
      >
        {tr('插入')}
      </Button>
    </div>
  )
}
