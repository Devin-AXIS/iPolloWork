import { useEffect, useRef, useState } from 'react'
import type { RecordDocument } from '../../core/documents'
import { documentContentInput, documentValueEqual } from '../../core/documents'
import { mergeDocument, type DocumentDraft } from '../../core/document-merge'
import { api, ApiError, message } from '../api'
import { translate as tr } from '../i18n'
const equal = (a: DocumentDraft, b: DocumentDraft) =>
  a.title === b.title && documentValueEqual(a.content, b.content)
export function useDocumentDraft(
  initial: RecordDocument,
  baseUrl: string,
  onSaved: (doc: RecordDocument) => void,
  active: boolean,
) {
  const key = `ipollo-data.document-draft:${initial.projectId}:${initial.id}`
  const base = useRef(initial),
    desired = useRef<DocumentDraft>({ title: initial.title, content: initial.content }),
    running = useRef<Promise<boolean> | null>(null)
  const alive = useRef(true),
    blocked = useRef(false),
    dirty = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const callback = useRef(onSaved)
  callback.current = onSaved
  const [draft, setDraft] = useState(desired.current),
    [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error' | 'conflict'>('saved'),
    [error, setError] = useState(''),
    [remote, setRemote] = useState<RecordDocument>()
  const [storageWarning, setStorageWarning] = useState('')
  const persist = () => {
    try {
      if (dirty.current)
        localStorage.setItem(key, JSON.stringify({ base: base.current, draft: desired.current }))
      else localStorage.removeItem(key)
    } catch {
      if (alive.current) setStorageWarning(tr('本机草稿空间不足，请保持页面打开直到保存成功'))
    }
  }
  const publish = (value: DocumentDraft) => {
    desired.current = value
    dirty.current = !equal(value, base.current)
    if (alive.current) setDraft(value)
  }
  const update = (value: DocumentDraft) => {
    publish(value)
    if (!blocked.current) setStatus(dirty.current ? 'pending' : 'saved')
  }
  async function drain(): Promise<boolean> {
    let conflicts = 0
    while (dirty.current && !blocked.current) {
      const sent = desired.current
      if (!sent.title.trim()) {
        setError(tr('请填写文档标题'))
        setStatus('error')
        return false
      }
      setStatus('saving')
      setError('')
      persist()
      try {
        const saved = await api<RecordDocument>(`${baseUrl}/${initial.id}`, 'PATCH', {
          version: base.current.version,
          title: sent.title,
          content: sent.content,
        })
        base.current = saved
        if (equal(desired.current, sent)) publish({ title: saved.title, content: saved.content })
        else dirty.current = !equal(desired.current, saved)
        callback.current(saved)
        persist()
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          try {
            const latest = await api<RecordDocument>(`${baseUrl}/${initial.id}`)
            const merged = mergeDocument(base.current, desired.current, latest)
            if (merged && ++conflicts <= 3) {
              base.current = latest
              publish(merged)
              callback.current(latest)
              persist()
              continue
            }
            setRemote(latest)
            callback.current(latest)
            setStatus('conflict')
            setError(tr('这段内容也被其他编辑修改了，草稿已保留'))
          } catch (readError) {
            setStatus('error')
            setError(message(readError))
          }
        } else {
          setStatus('error')
          setError(message(e))
        }
        blocked.current = true
        persist()
        return false
      }
    }
    if (alive.current) setStatus(dirty.current ? 'conflict' : 'saved')
    return !dirty.current
  }
  const flush = (): Promise<boolean> => {
    if (running.current) return running.current
    if (blocked.current) return Promise.resolve(false)
    running.current = drain().finally(() => {
      running.current = null
    })
    return running.current
  }
  const latestFlush = useRef(flush)
  latestFlush.current = flush
  useEffect(() => {
    alive.current = true
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (
        saved?.base?.id === initial.id &&
        typeof saved.draft?.title === 'string' &&
        documentContentInput.safeParse(saved.draft.content).success &&
        documentContentInput.safeParse(saved.base.content).success
      ) {
        const merged = mergeDocument(saved.base, saved.draft, initial)
        if (merged) {
          publish(merged)
          setStatus(dirty.current ? 'pending' : 'saved')
        } else {
          publish(saved.draft)
          blocked.current = true
          setRemote(initial)
          setStatus('conflict')
          setError(tr('发现未保存草稿，云端内容已有更新'))
        }
      }
    } catch {
      /* Ignore malformed local cache; the database remains authoritative. */
    }
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        persist()
        event.preventDefault()
      }
    }
    const hide = () => {
      persist()
      if (!document.hidden) void poll()
    }
    const focus = () => void poll()
    async function poll() {
      if (dirty.current || running.current || document.hidden || !activeRef.current) return
      try {
        const head = await api<{ version: number }>(`${baseUrl}/${initial.id}/version`)
        if (head.version === base.current.version) return
        const latest = await api<RecordDocument>(`${baseUrl}/${initial.id}`)
        if (
          !alive.current ||
          dirty.current ||
          running.current ||
          latest.version === base.current.version
        )
          return
        base.current = latest
        publish({ title: latest.title, content: latest.content })
        callback.current(latest)
      } catch {
        /* Explicit reads/saves still report errors; background refresh stays quiet. */
      }
    }
    const timer = setInterval(() => void poll(), 5000)
    window.addEventListener('beforeunload', leave)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', hide)
    return () => {
      persist()
      alive.current = false
      clearInterval(timer)
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', hide)
    }
    // The session is keyed by document ID. Server acknowledgements stay in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    if (!dirty.current) return
    const disk = setTimeout(persist, 250)
    const timer = setTimeout(() => void latestFlush.current(), 800)
    return () => {
      clearTimeout(disk)
      clearTimeout(timer)
    }
  }, [draft])
  async function retry() {
    try {
      const latest = await api<RecordDocument>(`${baseUrl}/${initial.id}`)
      const merged = mergeDocument(base.current, desired.current, latest)
      if (!merged) {
        setRemote(latest)
        setStatus('conflict')
        return
      }
      base.current = latest
      publish(merged)
      blocked.current = false
      setError('')
      await flush()
    } catch (e) {
      setError(message(e))
    }
  }
  function acceptRemote() {
    if (!remote) return
    base.current = remote
    publish({ title: remote.title, content: remote.content })
    blocked.current = false
    setRemote(undefined)
    setError('')
    setStatus('saved')
    callback.current(remote)
    persist()
  }
  return {
    draft,
    update,
    status,
    error,
    storageWarning,
    remote,
    flush,
    retry,
    acceptRemote,
    discard: () => {
      dirty.current = false
      try {
        localStorage.removeItem(key)
      } catch {
        /* Document copy is already committed. */
      }
    },
  }
}
