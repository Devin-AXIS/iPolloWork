import { translate as tr, useLocale } from './i18n'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ExtensionState } from '../core/extensions'
import { api, message } from './api'
import { syncClientPlugins } from './plugin-runtime'
import { LoadingState, ErrorNotice } from './components/primitives'
import type { PluginUpload, PluginImportPreview } from '../core/plugin-archive'

const Context = createContext<{
  extensions: ExtensionState[]
  error: string
  loading: boolean
  setProjectScope: (id: string | null) => void
  change: (id: string, action: string) => Promise<void>
  previewImport: (input: PluginUpload) => Promise<PluginImportPreview>
  importPackage: (input: PluginUpload) => Promise<void>
} | null>(null)
export function ExtensionProvider({ children }: { children: ReactNode }) {
  useLocale()
  const [ready, setReady] = useState(false)
  const [projectScope, setProjectScope] = useState<string | null>(() =>
    new URLSearchParams(window.location.hash.slice(1)).get('project'),
  )
  const [state, setState] = useState<{ scope: string | null; extensions: ExtensionState[] }>({
    scope: projectScope,
    extensions: [],
  })
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  const activeScope = useRef(projectScope),
    request = useRef(0)
  activeScope.current = projectScope
  const query = projectScope ? `?projectId=${projectScope}` : ''
  const load = useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    try {
      const received = await api<ExtensionState[]>(`/extensions${query}`)
      if (current !== request.current || activeScope.current !== projectScope) return
      const extensions = await syncClientPlugins(received)
      if (current === request.current && activeScope.current === projectScope) {
        setState({ scope: projectScope, extensions })
        setError('')
        setReady(true)
      }
    } catch (e) {
      if (current === request.current && activeScope.current === projectScope) {
        setError(message(e))
        setState({ scope: projectScope, extensions: [] })
      }
    } finally {
      if (current === request.current && activeScope.current === projectScope) setLoading(false)
    }
  }, [projectScope, query])
  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  async function change(id: string, action: string) {
    return mutate(`/extensions/${id}`, { action })
  }
  async function mutate(path: string, body: unknown) {
    const current = ++request.current
    const received = await api<ExtensionState[]>(`${path}${query}`, 'POST', body)
    if (current !== request.current || activeScope.current !== projectScope) return
    const extensions = await syncClientPlugins(received)
    if (current === request.current && activeScope.current === projectScope) {
      setState({ scope: projectScope, extensions })
      setError('')
      setLoading(false)
    }
  }
  return (
    <Context.Provider
      value={{
        extensions: state.scope === projectScope ? state.extensions : [],
        error,
        loading: loading || state.scope !== projectScope,
        setProjectScope,
        change,
        previewImport: (input) =>
          api<PluginImportPreview>(`/extensions/import/preview${query}`, 'POST', input),
        importPackage: (input) => mutate('/extensions/import', input),
      }}
    >
      {ready ? (
        children
      ) : error ? (
        <div className="center-loading">
          <ErrorNotice error={error} />
          <button onClick={load}>{tr('重新连接')}</button>
        </div>
      ) : (
        <LoadingState>{tr('正在加载数据工作台…')}</LoadingState>
      )}
    </Context.Provider>
  )
}
export function useExtensions() {
  const context = useContext(Context)
  if (!context) throw new Error(tr('缺少扩展上下文'))
  return context
}
