import { explorationFromHash, explorationHref } from '../core/exploration'
import {
  publishWorkspaceSelection,
  subscribeWorkbench,
  workbenchSnapshot,
  queueWorkbenchFocus,
  setWorkbenchFollowing,
  bindWorkbench,
  workspaceEditing,
} from './workspace-host'
import { watchProjectChanges } from './live-data'
import { focusInput, type WorkbenchFocus, type LiveActivity } from '../core/live-data'
import { BuildActivity } from './components/build-activity'
import type { EntityIconId } from '../core/icons'
import { referencesField } from '../core/field-management'
import { emptyQuery, recordQueryInput, type RecordQuery } from '../core/query'
import { readPreference, savePreference } from './i18n'
import { translate as tr, useLocale } from './i18n'
import type { DatabaseChoice } from '../core/database'
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
  lazy,
  Suspense,
} from 'react'
import { Button } from '@radix-ui/themes'
import type { DataRecord, FieldDef, Project, TableData, TableDef } from '../core/contracts'
import { api, message } from './api'
import { CreateDialog, FieldDialog } from './forms'
import { RecordDrawer } from './record-drawer'
import { ErrorNotice, Modal, LoadingState } from './components/primitives'
import { Sidebar, Topbar } from './components/navigation'
import { ProjectsPage, ProjectOverview } from './pages/projects'
import { TableWorkspace } from './components/table-workspace'
import { ExtensionsDialog } from './extensions'
import { useExtensions } from './extension-context'
const ProjectDialog = lazy(() =>
  import('./project-dialog').then((m) => ({ default: m.ProjectDialog })),
)
const TableCreateDialog = lazy(() =>
  import('./table-create-dialog').then((m) => ({ default: m.TableCreateDialog })),
)
const BlueprintDialog = lazy(() =>
  import('./blueprint-dialog').then((m) => ({ default: m.BlueprintDialog })),
)
const AutomationDialog = lazy(() =>
  import('./automation-dialog').then((m) => ({ default: m.AutomationDialog })),
)
const IntegrationDialog = lazy(() =>
  import('./integration-dialog').then((m) => ({ default: m.IntegrationDialog })),
)

type DialogState =
  | 'project-manage'
  | 'project'
  | 'table'
  | 'field'
  | 'record'
  | 'extensions'
  | 'blueprint'
  | 'automation'
  | 'integration'
  | 'schema'
  | 'delete-table'
  | null
const searchInitial = new URLSearchParams(window.location.hash.slice(1))
function savedSelection(tableId: string | null): RecordQuery {
  try {
    return recordQueryInput.parse(
      JSON.parse(readPreference(`ipollo-data.query.${tableId}`) ?? '{}'),
    )
  } catch {
    return emptyQuery()
  }
}
export default function App() {
  useLocale()
  const workbench = useSyncExternalStore(subscribeWorkbench, workbenchSnapshot)
  const [focus, setFocus] = useState<WorkbenchFocus>()
  const [focusSerial, setFocusSerial] = useState(0)
  const focusRequest = useRef(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readPreference('ipollo-data.sidebar-collapsed') === 'true' || window.innerWidth <= 600,
  )
  const [iconBusy, setIconBusy] = useState(false)
  const presentationBusy = useRef(false)
  function toggleSidebar() {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    savePreference('ipollo-data.sidebar-collapsed', String(next))
  }
  const apiRefresh = useRef(false)
  const [apiLoading, setApiLoading] = useState(false)
  const [activities, setActivities] = useState<LiveActivity[]>([])
  const { extensions, setProjectScope } = useExtensions()
  const [projects, setProjects] = useState<Project[]>([]),
    [tables, setTables] = useState<TableDef[]>([])
  const [projectId, setProjectId] = useState<string | null>(searchInitial.get('project')),
    [tableId, setTableId] = useState<string | null>(searchInitial.get('table'))
  const [data, setData] = useState<TableData | null>(null),
    [loading, setLoading] = useState(true),
    [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [dialog, setDialog] = useState<DialogState>(null)
  const dialogRef = useRef(dialog)
  const cellEditing = useRef(false)
  dialogRef.current = dialog
  const [record, setRecord] = useState<DataRecord | undefined>(),
    [recordDefaults, setRecordDefaults] = useState<Record<string, unknown>>(),
    [recordData, setRecordData] = useState<TableData>(),
    [editingField, setEditingField] = useState<FieldDef | undefined>(),
    [view, setView] = useState(searchInitial.get('view') === 'relations' ? 'relations' : 'grid'),
    [exploration, setExploration] = useState(() => explorationFromHash(window.location.hash)),
    [infoOpen, setInfoOpen] = useState(false)
  const [selection, setSelection] = useState<RecordQuery>(() =>
    savedSelection(searchInitial.get('table')),
  )
  const query = selection.search
  const setQuery = (search: string) => {
    setFocus(undefined)
    setSelection((current) => ({ ...current, search }))
  }
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [projectQuery, setProjectQuery] = useState('')
  const [exampleBusy, setExampleBusy] = useState(false),
    [schema, setSchema] = useState<unknown>(),
    [health, setHealth] = useState(false)
  useEffect(() => setProjectScope(projectId), [projectId, setProjectScope])
  const project = projects.find((p) => p.id === projectId)
  const projectTables = tables.filter((t) => t.projectId === projectId)

  const loadCatalog = useCallback(async () => {
    const [p, t] = await Promise.all([api<Project[]>('/projects'), api<TableDef[]>('/tables')])
    setProjects(p)
    setTables(t)
  }, [])
  useEffect(() => {
    setActivities([])
    const watchedProject = workbench.binding?.projectId ?? projectId
    if (!watchedProject) return
    let active = true
    const stop = watchProjectChanges(
      watchedProject,
      async () => {
        await loadCatalog()
        if (active) setRevision((v) => v + 1)
      },
      () => Boolean(dialogRef.current || cellEditing.current || presentationBusy.current),
      (activity) => {
        if (!activity) {
          if (active) setActivities([])
          return
        }
        if (activity.workbenchId && activity.workbenchId !== workbench.id) return
        if (
          activity.workbenchId === workbench.id &&
          activity.phase === 'complete' &&
          activity.focus
        )
          queueWorkbenchFocus(activity.focus)
        if (active)
          setActivities((previous) => {
            const found = previous.some((a) => a.id === activity.id)
            return (
              found
                ? previous.map((a) => (a.id === activity.id ? activity : a))
                : [...previous, activity]
            ).slice(-4)
          })
      },
      workbench.id,
    )
    return () => {
      active = false
      stop()
    }
  }, [projectId, loadCatalog, workbench.id, workbench.binding?.projectId])
  useEffect(() => {
    if (!focus || !data || tableLoading) return
    const frame = requestAnimationFrame(() => {
      const ids = focus.fieldId ? [focus.fieldId] : (focus.recordIds ?? [])
      const attribute = focus.fieldId ? 'data-field-id' : 'data-record-id'
      const elements = ids
        .map((id) => document.querySelector(`[${attribute}="${CSS.escape(id)}"]`))
        .filter((element) => element !== null)
      elements.forEach((element) => element.classList.add('onto-focus-block'))
      elements.at(-1)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focus, data, tableLoading, focusSerial])
  const reveal = useRef<(target: WorkbenchFocus) => Promise<void>>(async () => {})
  reveal.current = async (target) => {
    const request = ++focusRequest.current
    const channel = workbenchSnapshot().id
    if (
      workspaceEditing() ||
      cellEditing.current ||
      (dialogRef.current && dialogRef.current !== 'record')
    ) {
      setWorkbenchFollowing(false)
      queueWorkbenchFocus(target)
      return
    }
    const params = new URLSearchParams(target.href.split('#')[1])
    const nextProject = params.get('project'),
      nextTable = params.get('table')
    if (!nextProject) return
    try {
      const [catalog, context] = await Promise.all([
        api<TableDef[]>('/tables'),
        nextTable && target.recordId
          ? api<TableData>(`/tables/${nextTable}/records?recordId=${target.recordId}`)
          : Promise.resolve(undefined),
      ])
      if (request !== focusRequest.current || channel !== workbenchSnapshot().id) return
      if (
        workspaceEditing() ||
        cellEditing.current ||
        (dialogRef.current && dialogRef.current !== 'record')
      ) {
        setWorkbenchFollowing(false)
        queueWorkbenchFocus(target)
        return
      }
      if (
        nextTable &&
        !catalog.some((table) => table.id === nextTable && table.projectId === nextProject)
      )
        throw new Error(tr('记录不存在'))
      if (target.recordId && !context?.records[0]) throw new Error(tr('记录不存在'))
      setTables(catalog)
      if (tableId !== nextTable) setData(null)
      setProjectId(nextProject)
      setTableId(nextTable)
      setPage(target.page ?? 1)
      setSelection(emptyQuery())
      setExploration(explorationFromHash(target.href.slice(1)))
      setView(params.get('view') === 'relations' ? 'relations' : 'grid')
      setFocus(target)
      setFocusSerial((value) => value + 1)
      setRevision((value) => value + 1)
      setRecordData(context)
      setRecord(context?.records[0])
      setDialog(context ? 'record' : null)
      await loadCatalog()
      // Same-route requests also receive an acknowledgement after resolving their target.
      window.setTimeout(publishWorkspaceSelection, 0)
    } catch (error) {
      setError(message(error))
    }
  }
  useEffect(() => {
    const handler = (event: Event) => {
      const parsed = focusInput.safeParse((event as CustomEvent).detail)
      if (parsed.success) void reveal.current(parsed.data)
    }
    window.addEventListener('onto:reveal', handler)
    return () => window.removeEventListener('onto:reveal', handler)
  }, [])
  useEffect(() => {
    loadCatalog()
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false))
    api('/health')
      .then(() => setHealth(true))
      .catch(() => setHealth(false))
  }, [loadCatalog])
  useEffect(() => {
    const navigate = () => {
      focusRequest.current++
      setFocus(undefined)
      const params = new URLSearchParams(window.location.hash.slice(1))
      setProjectId(params.get('project'))
      setTableId(params.get('table'))
      setData(null)
      setPage(1)
      setSelection(savedSelection(params.get('table')))
      setView(params.get('view') === 'relations' ? 'relations' : 'grid')
      setExploration(explorationFromHash(window.location.hash))
      setError('')
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => {
    const params = new URLSearchParams()
    if (projectId) params.set('project', projectId)
    if (tableId) params.set('table', tableId)
    if (tableId && view === 'relations') {
      params.set('view', 'relations')
      if (exploration) params.set('explore', JSON.stringify(exploration))
    }
    window.history.replaceState(
      null,
      '',
      window.location.pathname +
        window.location.search +
        (params.size ? '#' + params.toString() : ''),
    )
    publishWorkspaceSelection()
  }, [projectId, tableId, view, exploration])
  useEffect(() => {
    if (tableId && !focus) savePreference(`ipollo-data.query.${tableId}`, JSON.stringify(selection))
  }, [tableId, selection, focus])
  useEffect(() => {
    setApiLoading(false)
    if (!tableId) {
      setData(null)
      return
    }
    let active = true,
      running = false
    let interval: ReturnType<typeof setInterval> | undefined
    const force = apiRefresh.current
    apiRefresh.current = false
    const endpoint = `/tables/${tableId}/records?page=${page}&selection=${encodeURIComponent(JSON.stringify(selection))}`
    async function resolve(refresh = false) {
      if (running || !active) return
      running = true
      setApiLoading(true)
      try {
        const result = await api<TableData>(endpoint + (refresh ? '&refresh=1' : ''))
        if (active) {
          setData((current) =>
            current?.table.id === result.table.id && current.table.version > result.table.version
              ? { ...result, table: current.table, fields: current.fields }
              : result,
          )
          setError('')
        }
      } catch (e) {
        if (active)
          setData((current) =>
            current?.table.id === tableId
              ? {
                  ...current,
                  records: current.records.map((record) => ({
                    ...record,
                    dynamic: {
                      ...record.dynamic,
                      ...Object.fromEntries(
                        current.fields
                          .filter((f) => f.source)
                          .map((f) => [
                            f.id,
                            {
                              ...record.dynamic?.[f.id],
                              status: record.values[f.id] != null ? 'stale' : 'unavailable',
                              source: record.dynamic?.[f.id]?.source ?? 'API',
                              simulated: f.source?.provider === 'demo-stock',
                              error: message(e),
                            },
                          ]),
                      ),
                    },
                  })),
                }
              : current,
          )
      } finally {
        running = false
        if (active) setApiLoading(false)
      }
    }
    setTableLoading(true)
    const timer = setTimeout(
      async () => {
        try {
          const result = await api<TableData>(endpoint + '&dynamic=defer')
          if (!active) return
          setData((current) =>
            current?.table.id === result.table.id && current.table.version > result.table.version
              ? { ...result, table: current.table, fields: current.fields }
              : result,
          )
          setError('')
          setTableLoading(false)
          if (page > Math.max(1, Math.ceil(result.total / result.pageSize))) {
            setPage(Math.max(1, Math.ceil(result.total / result.pageSize)))
            return
          }
          const sources = result.fields.flatMap((f) => (f.source ? [f.source] : []))
          if (sources.length && (!result.queryInfo?.snapshotFields.length || force)) {
            void resolve(force)
            if (!result.queryInfo?.snapshotFields.length)
              interval = setInterval(
                () => {
                  if (!document.hidden && !dialogRef.current && !cellEditing.current) void resolve()
                },
                Math.min(...sources.map((s) => s.ttlSeconds)) * 1000,
              )
          }
        } catch (e) {
          if (active) {
            setError(message(e))
            // Keep the controls available so an invalid or removed field can be corrected.
            if (!data) {
              const fallback = await api<TableData>(
                `/tables/${tableId}/records?dynamic=defer`,
              ).catch(() => null)
              if (active) setData(fallback)
            }
          }
        } finally {
          if (active) setTableLoading(false)
        }
      },
      query ? 180 : 0,
    )
    return () => {
      active = false
      clearTimeout(timer)
      if (interval) clearInterval(interval)
    }
  }, [tableId, page, selection, revision])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(timer)
  }, [notice])
  function chooseTable(id: string | null) {
    focusRequest.current++
    setFocus(undefined)
    if (window.innerWidth <= 600) setSidebarCollapsed(true)
    setTableId(id)
    setPage(1)
    setSelection(savedSelection(id))
    setData(null)
    setView('grid')
    setExploration(undefined)
  }
  function chooseProject(id: string | null) {
    setProjectId(id)
    chooseTable(tables.find((t) => t.projectId === id)?.id ?? null)
    setError('')
  }
  function refreshed(text = tr('已保存')) {
    setRevision((v) => v + 1)
    loadCatalog().catch((e) => setError(message(e)))
    setNotice(text)
  }
  async function create(
    name: string,
    description: string,
    color: string,
    database?: DatabaseChoice,
    icon?: EntityIconId,
  ) {
    const result = await api<Project>('/projects', 'POST', {
      name,
      description,
      color,
      database,
      icon,
    })
    await loadCatalog()
    setProjectId(result.id)
    chooseTable(null)
    setNotice(tr('创建成功'))
  }
  async function example(research = false) {
    setExampleBusy(true)
    setError('')
    try {
      const result = await api<{ project: Project; tableId: string }>(
        research ? '/examples/research' : '/examples',
        'POST',
      )
      await loadCatalog()
      setProjectId(result.project.id)
      chooseTable(result.tableId)
      setNotice(tr('示例数据已准备好，可以自由编辑'))
    } catch (err) {
      setError(message(err))
    } finally {
      setExampleBusy(false)
    }
  }
  async function showSchema() {
    setSchema(undefined)
    try {
      setSchema(await api(`/projects/${projectId}/schema`))
      setDialog('schema')
    } catch (err) {
      setError(message(err))
      setDialog(null)
    }
  }
  async function removeTable() {
    try {
      await api(`/tables/${tableId}`, 'DELETE')
      await loadCatalog()
      chooseTable(null)
      setDialog(null)
      setNotice(tr('数据表已删除'))
    } catch (err) {
      setError(message(err))
      setDialog(null)
    }
  }
  async function reorderTables(ids: string[]) {
    if (!projectId || presentationBusy.current) return
    presentationBusy.current = true
    try {
      await api(`/projects/${projectId}/tables/order`, 'PATCH', {
        ids,
        previousIds: projectTables.map((t) => t.id),
      })
      setTables((current) => {
        const selected = new Map(current.filter((t) => ids.includes(t.id)).map((t) => [t.id, t]))
        return [
          ...current.filter((t) => !ids.includes(t.id)),
          ...ids.flatMap((id, position) =>
            selected.has(id) ? [{ ...selected.get(id)!, position }] : [],
          ),
        ]
      })
      setNotice(tr('顺序已保存'))
    } catch (e) {
      setError(message(e))
      await loadCatalog().catch(() => {})
    } finally {
      presentationBusy.current = false
    }
  }
  async function reorderFields(ids: string[]) {
    if (!data || presentationBusy.current) return
    presentationBusy.current = true
    const id = data.table.id
    try {
      const result = await api<Pick<TableData, 'table' | 'fields'>>(
        `/tables/${id}/fields/order`,
        'PATCH',
        { ids, version: data.table.version },
      )
      setData((current) => (current?.table.id === id ? { ...current, ...result } : current))
      setTables((current) => current.map((t) => (t.id === id ? result.table : t)))
      setNotice(tr('顺序已保存'))
    } catch (e) {
      setError(message(e))
    } finally {
      presentationBusy.current = false
    }
  }
  async function changeTableIcon(icon: EntityIconId) {
    if (!data || presentationBusy.current || icon === data.table.icon) return
    presentationBusy.current = true
    setIconBusy(true)
    const id = data.table.id
    try {
      const table = await api<TableDef>(`/tables/${id}`, 'PATCH', {
        icon,
        version: data.table.version,
      })
      setData((current) => (current?.table.id === id ? { ...current, table } : current))
      setTables((current) => current.map((t) => (t.id === id ? table : t)))
      setNotice(tr('图标已保存'))
    } catch (e) {
      setError(message(e))
    } finally {
      presentationBusy.current = false
      setIconBusy(false)
    }
  }
  return (
    <div className="app-shell">
      <BuildActivity activities={activities} />
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        onReorderTables={reorderTables}
        projects={projects}
        project={project}
        projectId={projectId}
        tableId={tableId}
        projectTables={projectTables}
        health={health}
        extensionCount={extensions.filter((e) => e.enabled).length}
        chooseProject={chooseProject}
        chooseTable={chooseTable}
        onCreateProject={() => setDialog('project')}
        onCreateTable={() => setDialog('table')}
        onExtensions={() => setDialog('extensions')}
      />
      <main className="main-shell">
        <Topbar
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          project={project}
          table={data?.table}
          chooseProject={chooseProject}
          chooseTable={chooseTable}
          onExtensions={() => setDialog('extensions')}
          onBuild={() => setDialog('blueprint')}
          onManageProject={() => setDialog('project-manage')}
        />
        {error && (
          <div className="page-error">
            <ErrorNotice error={error} />
            <Button
              size="1"
              color="gray"
              variant="soft"
              onClick={() => {
                setError('')
                loadCatalog().catch((e) => setError(message(e)))
                setRevision((v) => v + 1)
              }}
            >
              {tr('重新加载')}
            </Button>
          </div>
        )}
        {workbench.id && (
          <div className="workbench-context" aria-label={tr('当前对话项目')}>
            <span>
              {workbench.binding
                ? tr('本对话：{0}', { 0: workbench.binding.name })
                : tr('本对话尚未关联项目')}
            </span>
            {project && workbench.binding?.projectId !== project.id && (
              <Button
                size="1"
                color="gray"
                variant="ghost"
                onClick={() => void bindWorkbench(project.id).catch((e) => setError(message(e)))}
              >
                {tr('用于当前对话')}
              </Button>
            )}
            {workbench.binding && (
              <>
                <Button
                  size="1"
                  color="gray"
                  variant="ghost"
                  aria-pressed={workbench.following}
                  onClick={() => setWorkbenchFollowing(!workbench.following)}
                >
                  {workbench.following
                    ? tr('跟随 AI')
                    : workbench.pending
                      ? tr('继续跟随 AI')
                      : tr('已暂停跟随')}
                </Button>
                <Button
                  size="1"
                  color="gray"
                  variant="ghost"
                  onClick={() => void bindWorkbench(null).catch((e) => setError(message(e)))}
                >
                  {tr('解除关联')}
                </Button>
              </>
            )}
          </div>
        )}
        {loading ? (
          <LoadingState>{tr('正在打开项目…')}</LoadingState>
        ) : !projectId ? (
          <ProjectsPage
            projects={projects}
            query={projectQuery}
            onQueryChange={setProjectQuery}
            onCreateProject={() => setDialog('project')}
            onChooseProject={chooseProject}
            onExample={() => example()}
            onResearchExample={() => example(true)}
            exampleBusy={exampleBusy}
          />
        ) : !project ? (
          <div className="center-loading">
            <h2>{tr('找不到这个项目')}</h2>
            <Button onClick={() => chooseProject(null)}>{tr('返回项目')}</Button>
          </div>
        ) : !tableId ? (
          <ProjectOverview
            project={project}
            tables={projectTables}
            onCreateTable={() => setDialog('table')}
            onChooseTable={chooseTable}
            onManage={() => setDialog('project-manage')}
          />
        ) : tableLoading && !data ? (
          <LoadingState>{tr('正在读取数据…')}</LoadingState>
        ) : data ? (
          <TableWorkspace
            key={tableId}
            onCellEditingChange={(editing) => {
              cellEditing.current = editing
            }}
            onCellSaved={() => {
              apiRefresh.current = true
              refreshed()
            }}
            selection={selection}
            onSelectionChange={(next, nextLayout) => {
              setFocus(undefined)
              setSelection(next)
              setPage(1)
              if (nextLayout) setView(nextLayout)
            }}
            onViewSaved={() => refreshed(tr('视图已更新'))}
            onReorderFields={reorderFields}
            onIconChange={changeTableIcon}
            iconBusy={iconBusy}
            data={data}
            project={project}
            view={view}
            exploration={exploration}
            onExplorationQuery={(anchorId, query) => {
              // The view owns its exploration session. Updating its replay link must not
              // trigger hash navigation or remount the view and repeat the same query.
              window.history.replaceState(null, '', explorationHref(project.id, anchorId, query))
            }}
            infoOpen={infoOpen}
            query={query}
            page={page}
            loading={tableLoading}
            apiLoading={apiLoading}
            onApiRefresh={() => {
              apiRefresh.current = true
              setRevision((v) => v + 1)
            }}
            onViewChange={(value) => {
              setView(value)
              setExploration(undefined)
            }}
            onToggleInfo={() => setInfoOpen((v) => !v)}
            onQueryChange={setQuery}
            onPageChange={setPage}
            onSchema={showSchema}
            onAutomation={() => setDialog('automation')}
            onIntegration={() => setDialog('integration')}
            onDeleteTable={() => setDialog('delete-table')}
            onOpen={(r) => {
              setFocus(undefined)
              setRecordData(undefined)
              setRecord(r)
              setDialog('record')
            }}
            onCreateRecord={(values) => {
              setFocus(undefined)
              setRecordData(undefined)
              setRecord(undefined)
              setRecordDefaults(values)
              setDialog('record')
            }}
            onUpdateRecord={async (record, values) => {
              const id = data.table.id
              cellEditing.current = true
              try {
                await api(`/tables/${id}/records/${record.id}`, 'PATCH', {
                  version: record.version,
                  values,
                })
                const fresh = await api<TableData>(
                  `/tables/${id}/records?recordId=${record.id}&dynamic=defer`,
                )
                const saved = fresh.records[0]
                if (saved)
                  setData((current) =>
                    current?.table.id === id
                      ? {
                          ...current,
                          records: current.records.map((r) =>
                            r.id === saved.id && r.version <= saved.version ? saved : r,
                          ),
                        }
                      : current,
                  )
              } finally {
                cellEditing.current = false
                setRevision((v) => v + 1)
              }
            }}
            onAdd={() => {
              setRecordDefaults(undefined)
              setFocus(undefined)
              setRecordData(undefined)
              setRecord(undefined)
              setDialog('record')
            }}
            onAddField={() => {
              setEditingField(undefined)
              setDialog('field')
            }}
            onEditField={(field) => {
              setEditingField(field)
              setDialog('field')
            }}
            onOpenLinked={async (linkedTableId, recordId) => {
              const context = await api<TableData>(
                `/tables/${linkedTableId}/records?recordId=${recordId}`,
              )
              const current = context.records[0]
              if (!current) throw new Error(tr('记录已不存在，请刷新关系图'))
              setFocus(undefined)
              setRecordData(context)
              setRecord(current)
              setDialog('record')
            }}
          />
        ) : null}
      </main>
      {notice && (
        <div className="toast" role="status">
          <span className="status-dot" />
          {notice}
        </div>
      )}
      {dialog === 'project' && (
        <CreateDialog kind="project" onClose={() => setDialog(null)} onCreate={create} />
      )}
      {dialog === 'field' && data && (
        <FieldDialog
          key={editingField?.id ?? 'new'}
          field={editingField}
          data={data}
          tables={tables.filter((t) =>
            project?.storage?.mode === 'independent'
              ? t.projectId === projectId
              : projects.find((p) => p.id === t.projectId)?.storage?.mode !== 'independent',
          )}
          projects={projects}
          onClose={() => setDialog(null)}
          onSaved={(change) => {
            apiRefresh.current = true
            if (change?.deletedFieldIds?.length || change?.editedFieldId) {
              // Local transient filters have no saved-view dependency record.
              // Reset only when an edited/deleted field occurs in this query.
              const ids = new Set(change.deletedFieldIds ?? [change.editedFieldId!])
              setSelection((current) => (referencesField(current, ids) ? emptyQuery() : current))
            }
            refreshed(
              change?.deletedFieldIds
                ? tr('字段已删除')
                : editingField
                  ? tr('字段已更新')
                  : tr('字段已添加'),
            )
          }}
        />
      )}
      {dialog === 'record' && (recordData || data) && (
        <RecordDrawer
          key={`${record?.id ?? 'new'}:${focusSerial}`}
          data={(recordData ?? data)!}
          documentId={focus?.documentId}
          blockId={focus?.blockId}
          record={record}
          initialValues={recordDefaults}
          onClose={() => setDialog(null)}
          onSaved={() => refreshed()}
        />
      )}
      {dialog === 'extensions' && <ExtensionsDialog onClose={() => setDialog(null)} />}
      <Suspense fallback={<LoadingState>{tr('正在打开…')}</LoadingState>}>
        {dialog === 'table' && projectId && (
          <TableCreateDialog
            key={projectId}
            projectId={projectId}
            tables={tables.filter((table) => table.projectId === projectId)}
            onClose={() => setDialog(null)}
            onCreated={(result) => {
              chooseTable(result.tables[0]?.id ?? null)
              refreshed(result.replayed ? tr('已打开已有结构') : tr('创建成功'))
            }}
          />
        )}
        {dialog === 'project-manage' && project && (
          <ProjectDialog
            project={project}
            onClose={() => setDialog(null)}
            onSaved={() => refreshed(tr('项目已更新'))}
          />
        )}
        {(dialog === 'schema' || dialog === 'blueprint') && (
          <BlueprintDialog
            key={dialog}
            projectId={projectId ?? undefined}
            schema={dialog === 'schema' ? schema : undefined}
            onClose={() => setDialog(null)}
            onCreated={(result) => {
              setProjectId(result.projectId)
              chooseTable(result.tables[0]?.id ?? null)
              refreshed(result.replayed ? tr('已打开已有结构') : tr('数据结构已创建'))
            }}
          />
        )}
        {dialog === 'automation' && data && (
          <AutomationDialog data={data} onClose={() => setDialog(null)} />
        )}
        {dialog === 'integration' && data && (
          <IntegrationDialog
            scope={{ kind: 'table', id: data.table.id }}
            onClose={() => setDialog(null)}
          />
        )}
      </Suspense>
      {dialog === 'delete-table' && data && (
        <Modal
          title={tr('删除「{0}」？', { 0: data.table.name })}
          description={tr('这会删除 {0} 条记录，以及与这张表有关的关联。当前版本不支持恢复。', {
            0: data.table.recordCount,
          })}
          open
          onClose={() => setDialog(null)}
        >
          <div className="form-actions">
            <Button color="gray" variant="soft" onClick={() => setDialog(null)}>
              {tr('取消')}
            </Button>
            <Button color="red" onClick={removeTable}>
              {tr('确认删除')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
