import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button, DropdownMenu, IconButton, Select, TextField } from '@radix-ui/themes'
import {
  DotsHorizontalIcon,
  FileTextIcon,
  Link2Icon,
  PlusIcon,
  Cross2Icon,
} from '@radix-ui/react-icons'
import type { DocumentSummary, RecordDocument } from '../../core/documents'
import { documentText } from '../../core/documents'
import type { TableData } from '../../core/contracts'
import { api, message } from '../api'
import { translate as tr, useLocale } from '../i18n'
import { ErrorNotice, LoadingState } from '../components/primitives'
import DocumentEditor from './document-editor'
import { DocumentExport } from './document-export'
import { useDocumentDraft } from './use-document-draft'
export interface DocumentHandle {
  flush: () => Promise<boolean>
}
interface Props {
  initialDocumentId?: string
  blockId?: string
  active: boolean
  tableId: string
  recordId: string
  projectId: string
  recordTitle: string
  fields: TableData['fields']
  documents: DocumentSummary[]
  onDocuments: (docs: DocumentSummary[]) => void
  onOpen: (tableId: string, recordId: string) => void
}

export default forwardRef<DocumentHandle, Props>(function RecordDocuments(props, ref) {
  useLocale()
  const base = `/tables/${props.tableId}/records/${props.recordId}/documents`
  const [selected, setSelected] = useState(props.initialDocumentId ?? props.documents[0]?.id ?? ''),
    [doc, setDoc] = useState<RecordDocument>(),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attach, setAttach] = useState(false),
    [unlink, setUnlink] = useState(false)
  const session = useRef<DocumentHandle>(null)
  const pendingCreate = useRef<
    { id: string; title: string; content?: RecordDocument['content'] } | undefined
  >(undefined)
  useEffect(() => {
    if (!selected && props.documents[0]) setSelected(props.documents[0].id)
  }, [props.documents, selected])
  useImperativeHandle(ref, () => ({
    flush: () => session.current?.flush() ?? Promise.resolve(true),
  }))
  useEffect(() => {
    if (!selected) {
      setDoc(undefined)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    api<RecordDocument>(`${base}/${selected}`)
      .then((v) => {
        if (active) setDoc(v)
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
  }, [base, selected])
  const changed = (value: RecordDocument) => {
    setDoc(value)
    props.onDocuments(props.documents.map((d) => (d.id === value.id ? value : d)))
  }
  async function select(id: string) {
    if (await (session.current?.flush() ?? true)) {
      setSelected(id)
      setAttach(false)
      setUnlink(false)
    }
  }
  async function create(value?: Pick<RecordDocument, 'title' | 'content'>) {
    if (!value && !(await (session.current?.flush() ?? true))) return false
    setBusy(true)
    setError('')
    try {
      const candidate = {
        title: props.documents.length ? tr('新文档') : props.recordTitle,
        ...value,
      }
      if (
        !pendingCreate.current ||
        pendingCreate.current.title !== candidate.title ||
        JSON.stringify(pendingCreate.current.content) !== JSON.stringify(candidate.content)
      )
        pendingCreate.current = { id: crypto.randomUUID(), ...candidate }
      const next = await api<RecordDocument>(base, 'POST', pendingCreate.current)
      pendingCreate.current = undefined
      props.onDocuments([...props.documents, next])
      setDoc(next)
      setSelected(next.id)
      setAttach(false)
      return true
    } catch (e) {
      setError(message(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function link(documentId: string) {
    if (!(await (session.current?.flush() ?? true))) return
    setBusy(true)
    setError('')
    try {
      const next = await api<RecordDocument>(`${base}/${documentId}/link`, 'POST')
      props.onDocuments(
        props.documents.some((d) => d.id === next.id)
          ? props.documents
          : [...props.documents, next],
      )
      setDoc(next)
      setSelected(next.id)
      setAttach(false)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function detach() {
    if (!doc || !(await (session.current?.flush() ?? true))) return
    setBusy(true)
    setError('')
    try {
      await api(`${base}/${doc.id}/link`, 'DELETE')
      const remaining = props.documents.filter((d) => d.id !== doc.id)
      props.onDocuments(remaining)
      setSelected(remaining[0]?.id ?? '')
      setUnlink(false)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="record-documents">
      {props.documents.length > 0 && (
        <div className="document-switcher">
          <FileTextIcon />
          <Select.Root value={selected} onValueChange={(id) => void select(id)} disabled={busy}>
            <Select.Trigger aria-label={tr('选择文档')} variant="ghost">
              {tr('文档')}
              {props.documents.length > 1 ? ` · ${props.documents.length}` : ''}
            </Select.Trigger>
            <Select.Content>
              {props.documents.map((d) => (
                <Select.Item value={d.id} key={d.id}>
                  {d.title}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <span className="detail-action-spacer" />
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            aria-label={tr('添加文档')}
            disabled={busy}
            onClick={() => void create()}
          >
            <PlusIcon />
          </IconButton>
          <DocumentExport
            url={`/api${base}/${selected}/export`}
            disabled={busy || loading || !doc}
            prepare={() => session.current?.flush() ?? Promise.resolve(true)}
            onBusy={setBusy}
            onError={setError}
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                aria-label={tr('文档操作')}
                disabled={busy}
              >
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" size="1">
              <DropdownMenu.Item onSelect={() => setAttach(true)}>
                <Link2Icon />
                {tr('关联已有文档')}
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => setUnlink(true)}>
                {tr('从此记录移除')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      )}
      <ErrorNotice error={error} />
      {unlink && (
        <div className="document-inline-panel">
          <div>
            <p>{tr('仅解除当前记录的关联，正文会保留，可重新关联。')}</p>
            <Button
              size="1"
              color="gray"
              variant="soft"
              disabled={busy}
              onClick={() => setUnlink(false)}
            >
              {tr('取消')}
            </Button>{' '}
            <Button size="1" disabled={busy} onClick={() => void detach()}>
              {tr('解除关联')}
            </Button>
          </div>
        </div>
      )}
      {attach && (
        <div className="document-inline-panel">
          <ExistingDocuments
            projectId={props.projectId}
            onChoose={(id) => void link(id)}
            disabled={busy}
          />
          <IconButton
            variant="ghost"
            color="gray"
            aria-label={tr('关闭')}
            onClick={() => setAttach(false)}
          >
            <Cross2Icon />
          </IconButton>
        </div>
      )}
      {!props.documents.length ? (
        <div className="document-empty-page">
          <button className="document-start-writing" disabled={busy} onClick={() => void create()}>
            {busy ? tr('正在加载…') : tr('点击开始书写…')}
          </button>
          <Button variant="ghost" color="gray" size="1" onClick={() => setAttach(true)}>
            <Link2Icon />
            {tr('关联已有文档')}
          </Button>
        </div>
      ) : loading ? (
        <LoadingState>{tr('正在加载…')}</LoadingState>
      ) : (
        doc && (
          <DocumentSession
            key={doc.id}
            ref={session}
            doc={doc}
            base={base}
            {...props}
            onSaved={changed}
            onCopy={async (value) => {
              return create(value)
            }}
            onOpen={(tableId, recordId) =>
              void (session.current?.flush() ?? Promise.resolve(true)).then((ok) => {
                if (ok) props.onOpen(tableId, recordId)
              })
            }
          />
        )
      )}
    </div>
  )
})
const DocumentSession = forwardRef<
  DocumentHandle,
  Props & {
    doc: RecordDocument
    base: string
    onSaved: (doc: RecordDocument) => void
    onCopy: (value: Pick<RecordDocument, 'title' | 'content'>) => Promise<boolean>
  }
>(function DocumentSession(props, ref) {
  const state = useDocumentDraft(props.doc, props.base, props.onSaved, props.active)
  useImperativeHandle(ref, () => ({ flush: state.flush }))
  const labels = {
    saved: tr('已保存'),
    pending: tr('待保存'),
    saving: tr('保存中…'),
    error: tr('保存未完成'),
    conflict: tr('需要合并'),
  }
  return (
    <div className="document-session" data-onto-editing={state.status !== 'saved'}>
      <div className="document-meta">
        <span role="status">{labels[state.status]}</span>
        {props.doc.linkedRecords > 1 && (
          <span>
            <Link2Icon />
            {tr('{0} 条记录共用', { 0: props.doc.linkedRecords })}
          </span>
        )}
      </div>
      <input
        className="document-title"
        aria-label={tr('文档标题')}
        value={state.draft.title}
        maxLength={160}
        onChange={(e) => state.update({ ...state.draft, title: e.target.value })}
        onBlur={() => void state.flush()}
        placeholder={tr('文档标题')}
      />
      <ErrorNotice error={state.error || state.storageWarning} />
      {state.status === 'error' && (
        <Button size="1" variant="soft" color="gray" onClick={() => void state.retry()}>
          {tr('重试保存')}
        </Button>
      )}
      {state.status === 'conflict' && (
        <div className="document-conflict">
          {state.remote && (
            <details>
              <summary>{tr('查看最新正文')}</summary>
              <h4>{state.remote.title}</h4>
              <pre>{documentText(state.remote.content)}</pre>
            </details>
          )}
          <div>
            <Button size="1" variant="soft" color="gray" onClick={state.acceptRemote}>
              {tr('使用最新版本')}
            </Button>
            <Button
              size="1"
              onClick={async () => {
                await props.onCopy({
                  title: `${state.draft.title} · ${tr('草稿')}`,
                  content: state.draft.content,
                })
              }}
            >
              {tr('草稿另存为新文档')}
            </Button>
          </div>
        </div>
      )}
      <DocumentEditor
        focusBlockId={props.blockId}
        content={state.draft.content}
        onChange={(content) => state.update({ ...state.draft, content })}
        base={props.base}
        documentId={props.doc.id}
        projectId={props.projectId}
        tableId={props.tableId}
        recordId={props.recordId}
        relations={props.fields}
        onOpen={props.onOpen}
        onBlur={() => void state.flush()}
      />
    </div>
  )
})
function ExistingDocuments({
  projectId,
  onChoose,
  disabled,
}: {
  projectId: string
  onChoose: (id: string) => void
  disabled: boolean
}) {
  const [query, setQuery] = useState(''),
    [docs, setDocs] = useState<DocumentSummary[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      api<DocumentSummary[]>(`/projects/${projectId}/documents?q=${encodeURIComponent(query)}`)
        .then((v) => {
          if (active) {
            setDocs(v)
            setError('')
          }
        })
        .catch((e) => {
          if (active) setError(message(e))
        })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [projectId, query])
  return (
    <div className="document-picker">
      <strong>{tr('关联已有文档')}</strong>
      <TextField.Root
        aria-label={tr('搜索文档')}
        placeholder={tr('搜索文档（标题前缀）')}
        value={query}
        maxLength={80}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="document-choices">
        {docs.map((d) => (
          <button key={d.id} disabled={disabled} onClick={() => onChoose(d.id)}>
            <FileTextIcon />
            <span>{d.title}</span>
          </button>
        ))}
        {!docs.length && <p className="form-hint">{tr('没有匹配的文档')}</p>}
      </div>
      <ErrorNotice error={error} />
    </div>
  )
}
