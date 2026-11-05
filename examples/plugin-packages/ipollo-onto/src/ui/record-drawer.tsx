import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { DocumentSummary } from '../core/documents'
import type { DocumentHandle } from './documents/record-documents'
import { DocumentTableActions } from './documents/document-table-actions'
const RecordDocuments = lazy(() => import('./documents/record-documents'))
import { Button, IconButton, Tabs } from '@radix-ui/themes'
import {
  ArrowLeftIcon,
  ArrowTopRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross2Icon,
  FileTextIcon,
  MixerHorizontalIcon,
  DragHandleDots2Icon,
  Pencil1Icon,
  Link2Icon,
  ReloadIcon,
} from '@radix-ui/react-icons'
import {
  links,
  sourceUsesInput,
  type DataRecord,
  type FieldDef,
  type TableData,
  type TableDef,
} from '../core/contracts'
import { fieldTypes } from '../core/fields'
import { api, message } from './api'
import { translate as tr, useLocale } from './i18n'
import { Sheet, ErrorNotice, LoadingState } from './components/primitives'
import { FieldTypeIcon } from './components/icons'
import { useReorder } from './components/use-reorder'
import { FieldInput } from './fields/input'
import { FieldValue } from './fields/value'
import { detailFields, recordDraft } from './fields/record-draft'

type Entry = {
  data: TableData
  record?: DataRecord
  initialValues?: Record<string, unknown>
  documentId?: string
  blockId?: string
}
export function RecordDrawer({
  data,
  record,
  initialValues,
  documentId,
  blockId,
  onClose,
  onSaved,
}: Entry & { onClose: () => void; onSaved: () => void }) {
  const [path, setPath] = useState<Entry[]>([{ data, record, initialValues, documentId, blockId }])
  const current = path.at(-1)!
  async function navigate(tableId: string, recordId: string, back = false) {
    const next = await api<TableData>(`/tables/${tableId}/records?recordId=${recordId}`)
    if (!next.records[0]) throw new Error(tr('记录不存在'))
    const entry = { data: next, record: next.records[0] }
    setPath((stack) => (back ? [...stack.slice(0, -2), entry] : [...stack, entry]))
  }
  return (
    <RecordPanel
      key={`${current.data.table.id}:${current.record?.id ?? 'new'}`}
      {...current}
      onEntryChange={(entry) => setPath((stack) => [...stack.slice(0, -1), entry])}
      onClose={onClose}
      onSaved={onSaved}
      onNavigate={navigate}
      onCreate={(next, initialValues) =>
        setPath((stack) => [...stack, { data: next, initialValues }])
      }
      onBack={
        path.length > 1
          ? () => {
              const previous = path.at(-2)!
              return navigate(previous.data.table.id, previous.record!.id, true)
            }
          : undefined
      }
    />
  )
}

function RecordPanel({
  data: initialData,
  record: initialRecord,
  initialValues,
  documentId,
  blockId,
  onClose,
  onSaved,
  onNavigate,
  onCreate,
  onBack,
  onEntryChange,
}: Entry & {
  onClose: () => void
  onSaved: () => void
  onEntryChange: (entry: Entry) => void
  onNavigate: (tableId: string, recordId: string) => Promise<void>
  onCreate: (data: TableData, values: Record<string, unknown>) => void
  onBack?: () => Promise<void>
}) {
  useLocale()
  const [data, setData] = useState(initialData)
  const [record, setRecord] = useState(initialRecord)
  const [values, setValues] = useState(() => ({
    ...recordDraft(initialData, initialRecord),
    ...(!initialRecord ? initialValues : {}),
  }))
  const [dirty, setDirty] = useState(new Set<string>())
  const [editing, setEditing] = useState(!initialRecord)
  const [tab, setTab] = useState('details')
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [documentsMounted, setDocumentsMounted] = useState(false)
  const [referenceRevision, setReferenceRevision] = useState(0)
  const documentSession = useRef<DocumentHandle>(null)
  const tabChosen = useRef(false)
  useEffect(() => {
    if (!record) return
    let active = true
    api<DocumentSummary[]>(`/tables/${data.table.id}/records/${record.id}/documents`)
      .then((value) => {
        if (!active) return
        setDocuments(value)
        if (value.length && !tabChosen.current) {
          setTab('documents')
          setDocumentsMounted(true)
        }
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [data.table.id, record?.id])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, setPending] = useState<{ run: () => void } | null>(null)
  const ordinary = detailFields(data)
  const primary = data.fields.find((f) => f.isPrimary)
  const title = String(
    (primary && (editing ? values[primary.id] : record?.values[primary.id])) ||
      tr(record ? '未命名' : '新建记录'),
  )
  const imageField = ordinary.find((f) => f.type === 'image')
  const picture = imageField && record?.values[imageField.id]
  const [brokenImage, setBrokenImage] = useState(false)
  const core = ordinary
    .filter(
      (f) =>
        !f.isPrimary &&
        !['image', 'file', 'json', 'longtext', 'url'].includes(f.type) &&
        record?.values[f.id] != null &&
        record.values[f.id] !== '',
    )
    .slice(0, 3)
  const relations = data.fields.filter((f) => f.type === 'relation')
  const unsaved = dirty.size > 0
  useEffect(() => {
    if (!unsaved) return
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [unsaved])
  function request(action: () => void) {
    if (busy) return
    void (documentSession.current?.flush() ?? Promise.resolve(true)).then((ok) => {
      if (!ok) return
      if (unsaved) setPending({ run: action })
      else action()
    })
  }
  function reset() {
    setValues(recordDraft(data, record))
    setDirty(new Set())
    setEditing(false)
    setPending(null)
    setError('')
  }
  function referencedDataChanged() {
    setReferenceRevision((value) => value + 1)
    onSaved()
    if (!record) return
    // Refresh the owning record too: an embedded edit may change it or its reverse links.
    void api<TableData>(`/tables/${data.table.id}/records?recordId=${record.id}`)
      .then((fresh) => {
        if (!fresh.records[0]) return
        setData(fresh)
        setRecord(fresh.records[0])
        setValues((current) => ({
          ...recordDraft(fresh, fresh.records[0]),
          ...Object.fromEntries(Object.entries(current).filter(([id]) => dirty.has(id))),
        }))
      })
      .catch((e) => setError(message(e)))
  }
  function update(field: FieldDef, value: unknown) {
    setValues((v) => ({ ...v, [field.id]: value }))
    setDirty((v) => new Set([...v, field.id]))
  }
  async function save(): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError('')
    setNotice('')
    let saved = false
    try {
      const result = await api<{ id: string }>(
        `/tables/${data.table.id}/records${record ? '/' + record.id : ''}`,
        record ? 'PATCH' : 'POST',
        {
          version: record?.version,
          values: record
            ? Object.fromEntries(Object.entries(values).filter(([id]) => dirty.has(id)))
            : values,
        },
      )
      // The write is committed. Do not leave a retryable create form if the follow-up read fails.
      saved = true
      setDirty(new Set())
      setEditing(false)
      onSaved()
      const fresh = await api<TableData>(`/tables/${data.table.id}/records?recordId=${result.id}`)
      if (!fresh.records[0]) throw new Error(tr('记录不存在'))
      setData(fresh)
      setRecord(fresh.records[0])
      setValues(recordDraft(fresh, fresh.records[0]))
      setNotice(tr('已保存'))
      onEntryChange({ data: fresh, record: fresh.records[0] })
      return true
    } catch (e) {
      if (saved) {
        onClose()
        return true
      }
      setError(message(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function refresh() {
    if (!record) return
    await run(async () => {
      const fresh = await api<TableData>(
        `/tables/${data.table.id}/records?recordId=${record.id}&refresh=1`,
      )
      if (!fresh.records[0]) throw new Error(tr('记录不存在'))
      setData(fresh)
      setRecord(fresh.records[0])
      setValues(recordDraft(fresh, fresh.records[0]))
      setNotice(tr('已更新'))
    })
  }
  const reorder = useReorder(
    ordinary.map((f) => f.id),
    'y',
    busy
      ? undefined
      : async (fieldOrder) => {
          await run(async () => {
            const table = await api<TableDef>(`/tables/${data.table.id}/detail-layout`, 'PATCH', {
              fieldOrder,
              version: data.table.version,
            })
            setData((d) => ({ ...d, table }))
            setNotice(tr('详情顺序已保存'))
            onSaved()
          })
        },
  )
  const fieldValue = (field: FieldDef) => {
    const waiting =
      field.source &&
      (!record || (sourceUsesInput(field.source) && dirty.has(field.source.inputFieldId)))
    return waiting ? (
      <span className="form-hint">{tr('保存后自动获取')}</span>
    ) : (
      <FieldValue
        field={field}
        value={record?.values[field.id]}
        state={record?.dynamic?.[field.id]}
      />
    )
  }
  return (
    <Sheet title={tr('记录详情')} onClose={() => request(onClose)}>
      <div className="detail-topbar" data-onto-editing={editing || unsaved || busy}>
        <div>
          {onBack && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              aria-label={tr('返回上一条记录')}
              onClick={() => request(() => void run(onBack))}
            >
              <ArrowLeftIcon />
            </IconButton>
          )}
          <span>{data.table.name}</span>
        </div>
        <div>
          {record && !editing && (
            <Button
              size="1"
              variant="ghost"
              color="gray"
              disabled={busy}
              onClick={() => {
                setEditing(true)
                setNotice('')
              }}
            >
              <Pencil1Icon />
              {tr('编辑')}
            </Button>
          )}
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            aria-label={tr('关闭详情')}
            disabled={busy}
            onClick={() => request(onClose)}
          >
            <Cross2Icon />
          </IconButton>
        </div>
      </div>
      <header className="detail-hero">
        <div className="detail-heading">
          {imageField && (
            <div className="detail-avatar">
              {typeof picture === 'string' && /^https?:\/\//i.test(picture) && !brokenImage ? (
                <img
                  src={picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setBrokenImage(true)}
                />
              ) : (
                title.slice(0, 1)
              )}
            </div>
          )}
          <h2>{title}</h2>
        </div>
        {record && core.length > 0 && (
          <div className="detail-highlights">
            {core.map((field) => (
              <div key={field.id}>
                <span>{field.name}</span>
                {fieldValue(field)}
              </div>
            ))}
          </div>
        )}
      </header>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          tabChosen.current = true
          setTab(value)
          if (value === 'documents') setDocumentsMounted(true)
        }}
        className="detail-tabs"
      >
        <Tabs.List aria-label={tr('记录内容')} size="1">
          {record && (
            <Tabs.Trigger value="documents">
              <FileTextIcon />
              {tr('文档')}
              {documents.length > 1 && <span className="detail-count">{documents.length}</span>}
            </Tabs.Trigger>
          )}
          <Tabs.Trigger value="details">
            <MixerHorizontalIcon />
            {tr('详情')}
          </Tabs.Trigger>
          {relations.map((field) => (
            <Tabs.Trigger key={field.id} value={field.id}>
              <Link2Icon />
              {field.name}
              <span className="detail-count">
                {editing && Array.isArray(values[field.id])
                  ? (values[field.id] as unknown[]).length
                  : links(record?.values[field.id]).length}
              </span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="detail-scroll" ref={reorder.containerRef}>
          {record && documentsMounted && (
            <Tabs.Content value="documents" forceMount hidden={tab !== 'documents'}>
              <Suspense fallback={<LoadingState>{tr('正在加载…')}</LoadingState>}>
                <DocumentTableActions.Provider
                  value={{
                    revision: referenceRevision,
                    onCreate: (next, values) => request(() => onCreate(next, values)),
                    onChanged: referencedDataChanged,
                  }}
                >
                  <RecordDocuments
                    ref={documentSession}
                    initialDocumentId={documentId}
                    blockId={blockId}
                    active={tab === 'documents'}
                    tableId={data.table.id}
                    recordId={record.id}
                    projectId={data.table.projectId}
                    recordTitle={title}
                    fields={data.fields}
                    documents={documents}
                    onDocuments={setDocuments}
                    onOpen={(tableId, id) => request(() => void run(() => onNavigate(tableId, id)))}
                  />
                </DocumentTableActions.Provider>
              </Suspense>
            </Tabs.Content>
          )}
          <Tabs.Content value="details">
            <fieldset disabled={busy} className="detail-properties">
              {ordinary.map((field) => (
                <div key={field.id} className="detail-property" {...reorder.itemProps(field.id)}>
                  <div className="detail-property-label">
                    <button {...reorder.handleProps(field.id, field.name)}>
                      <DragHandleDots2Icon />
                    </button>
                    <FieldTypeIcon type={field.type} source={field.source} />
                    <label htmlFor={editing && !field.source ? field.id : undefined}>
                      {field.name}
                      {field.required && <span className="required-dot"> *</span>}
                    </label>
                  </div>
                  <div className="detail-property-value">
                    {editing && !field.source ? (
                      <FieldInput
                        field={field}
                        value={values[field.id]}
                        onChange={(v) => update(field, v)}
                      />
                    ) : (
                      fieldValue(field)
                    )}
                  </div>
                </div>
              ))}
            </fieldset>
          </Tabs.Content>
          {relations.map((field) => (
            <Tabs.Content key={field.id} value={field.id}>
              {editing ? (
                <fieldset disabled={busy} className="detail-relation-editor">
                  <p>{tr('选择关联记录，保存后两端同步更新。')}</p>
                  <FieldInput
                    field={field}
                    value={values[field.id]}
                    selectedLinks={links(record?.values[field.id])}
                    onChange={(v) => update(field, v)}
                  />
                </fieldset>
              ) : (
                record && (
                  <RelatedRecords
                    key={`${record.id}:${record.version}:${field.id}`}
                    tableId={data.table.id}
                    recordId={record.id}
                    field={field}
                    onOpen={(tableId, id) => request(() => void run(() => onNavigate(tableId, id)))}
                  />
                )
              )}
            </Tabs.Content>
          ))}
        </div>
      </Tabs.Root>
      <footer className="detail-footer">
        <ErrorNotice error={error} />
        {pending ? (
          <div className="detail-leave" role="alert">
            <p>{tr('有尚未保存的修改')}</p>
            <div>
              <Button variant="soft" color="gray" disabled={busy} onClick={() => setPending(null)}>
                {tr('继续编辑')}
              </Button>
              <Button
                variant="ghost"
                color="gray"
                disabled={busy}
                onClick={() => {
                  const action = pending.run
                  reset()
                  action()
                }}
              >
                {tr('放弃修改')}
              </Button>
              <Button
                loading={busy}
                onClick={async () => {
                  const action = pending.run
                  if (await save()) action()
                }}
              >
                {tr('保存并继续')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {confirmDelete && (
              <div className="detail-leave" role="alert">
                <p>{tr('删除将同时解除这条记录的关联，当前版本不支持恢复。')}</p>
                <div>
                  <Button
                    variant="soft"
                    color="gray"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    {tr('取消')}
                  </Button>
                  <Button
                    color="red"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/tables/${data.table.id}/records/${record!.id}`, 'DELETE', {
                          version: record!.version,
                        })
                        onSaved()
                        onClose()
                      })
                    }
                  >
                    {tr('确认删除')}
                  </Button>
                </div>
              </div>
            )}
            <div className="detail-actions">
              {editing ? (
                <>
                  {record && (
                    <Button
                      variant="ghost"
                      color="gray"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      {tr('删除记录')}
                    </Button>
                  )}
                  <span className="detail-action-spacer" />
                  <Button
                    variant="soft"
                    color="gray"
                    disabled={busy}
                    onClick={() => request(record ? reset : onClose)}
                  >
                    {tr('取消')}
                  </Button>
                  <Button
                    loading={busy}
                    disabled={Boolean(record && !unsaved)}
                    onClick={() => void save()}
                  >
                    {tr('保存记录')}
                  </Button>
                </>
              ) : (
                <>
                  <span className="form-hint" role="status">
                    {notice || (tab === 'documents' ? '' : tr('拖动字段左侧手柄调整顺序'))}
                  </span>
                  <span className="detail-action-spacer" />
                  {record && (
                    <IconButton
                      variant="ghost"
                      color="gray"
                      loading={busy}
                      aria-label={tr('刷新记录')}
                      onClick={() => void refresh()}
                    >
                      <ReloadIcon />
                    </IconButton>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </footer>
    </Sheet>
  )
}

function RelatedRecords({
  tableId,
  recordId,
  field,
  onOpen,
}: {
  tableId: string
  recordId: string
  field: FieldDef
  onOpen: (tableId: string, id: string) => void
}) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<TableData>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const focus = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api<TableData>(`/tables/${tableId}/records/${recordId}/relations/${field.id}?page=${page}`)
      .then((value) => {
        if (active) setData(value)
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
  }, [tableId, recordId, field.id, page])
  const columns = data
    ? [
        ...data.fields.filter((f) => f.isPrimary),
        ...detailFields(data)
          .filter((f) => !f.isPrimary)
          .slice(0, 3),
      ]
    : []
  return (
    <div className="detail-related" ref={focus} aria-busy={loading}>
      <ErrorNotice error={error} />
      {loading ? (
        <LoadingState>{tr('正在读取数据…')}</LoadingState>
      ) : (
        data &&
        !error && (
          <>
            <div className="detail-related-heading">
              <strong>{data.table.name}</strong>
              <span>{tr('{0} 条关联记录', { 0: data.total })}</span>
            </div>
            {data.total ? (
              <div className="detail-mini-scroll">
                <table className="detail-mini-table">
                  <thead>
                    <tr>
                      {columns.map((f) => (
                        <th key={f.id}>
                          <span>
                            <FieldTypeIcon type={f.type} source={f.source} />
                            {f.name}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((row) => (
                      <tr key={row.id}>
                        {columns.map((f, i) => (
                          <td key={f.id}>
                            {i === 0 ? (
                              <button
                                className="record-open"
                                onClick={() => onOpen(data.table.id, row.id)}
                                aria-label={tr('打开记录 {0}', {
                                  0:
                                    fieldTypes.get('text').format(row.values[f.id]) || tr('未命名'),
                                })}
                              >
                                <FieldValue field={f} value={row.values[f.id]} />
                                <ArrowTopRightIcon />
                              </button>
                            ) : (
                              <FieldValue
                                field={f}
                                value={row.values[f.id]}
                                state={row.dynamic?.[f.id]}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="detail-empty">{tr('暂无关联记录，进入编辑模式添加。')}</p>
            )}
            {data.total > data.pageSize && (
              <div className="detail-pagination">
                <IconButton
                  variant="soft"
                  color="gray"
                  aria-label={tr('上一页')}
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeftIcon />
                </IconButton>
                <span>
                  {page} / {Math.ceil(data.total / data.pageSize)}
                </span>
                <IconButton
                  variant="soft"
                  color="gray"
                  aria-label={tr('下一页')}
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRightIcon />
                </IconButton>
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}
