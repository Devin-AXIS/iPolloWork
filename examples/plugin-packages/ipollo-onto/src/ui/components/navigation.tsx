import type { CSSProperties } from 'react'
import { ResizeHandle, useSavedWidths } from './resize-handle'
import { translate as tr, useLocale } from '../i18n'
import { Badge, IconButton, Button } from '@radix-ui/themes'
import {
  GridIcon,
  Cross2Icon,
  PlusIcon,
  DragHandleDots2Icon,
  ChevronRightIcon,
  CubeIcon,
  GearIcon,
} from '@radix-ui/react-icons'
import type { Project, TableDef } from '../../core/contracts'
import { EntityIcon } from './icons'
import { useReorder } from './use-reorder'
import { PreferenceControls } from '../preferences'

interface NavigationProps {
  collapsed: boolean
  onToggle: () => void
  onReorderTables: (ids: string[]) => Promise<void>
  projects: Project[]
  project?: Project
  projectId: string | null
  tableId: string | null
  projectTables: TableDef[]
  health: boolean
  extensionCount: number
  chooseProject: (id: string | null) => void
  chooseTable: (id: string | null) => void
  onCreateProject: () => void
  onCreateTable: () => void
  onExtensions: () => void
}
export function Sidebar({
  collapsed,
  onToggle,
  onReorderTables,
  projects,
  project,
  projectId,
  tableId,
  projectTables,
  health,
  extensionCount,
  chooseProject,
  chooseTable,
  onCreateProject,
  onCreateTable,
  onExtensions,
}: NavigationProps) {
  useLocale()
  const layout = useSavedWidths('ipollo-data.sidebar-layout')
  const width = Math.min(400, Math.max(200, layout.widths.sidebar ?? 238))
  const reorder = useReorder(
    projectTables.map((t) => t.id),
    'y',
    onReorderTables,
  )
  if (collapsed) return null
  return (
    <>
      <button className="sidebar-backdrop" aria-label={tr('收起侧栏')} onClick={onToggle} />
      <aside
        className="sidebar"
        style={{ '--sidebar-width': `${width}px` } as CSSProperties}
        id="project-sidebar"
        aria-label={tr('项目导航')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onToggle()
        }}
      >
        <IconButton
          className="sidebar-mobile-close"
          variant="ghost"
          color="gray"
          aria-label={tr('收起侧栏')}
          onClick={onToggle}
        >
          <Cross2Icon />
        </IconButton>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            chooseProject(null)
          }}
        >
          <span className="brand-symbol">iP</span>
          <span>
            iPollo <b>Onto</b>
          </span>
          <Badge size="1" color="gray" variant="soft">
            {tr('预览')}
          </Badge>
        </a>
        <button
          className={`nav-home ${!projectId ? 'active' : ''}`}
          onClick={() => chooseProject(null)}
        >
          <GridIcon />
          <span>{tr('全部项目')}</span>
          <span className="nav-count">{projects.length}</span>
        </button>
        <div className="sidebar-divider" />
        <div className="sidebar-heading">
          <span>{project ? tr('当前项目') : tr('我的项目')}</span>
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            aria-label={tr('创建项目')}
            onClick={onCreateProject}
          >
            <PlusIcon />
          </IconButton>
        </div>
        {project ? (
          <>
            <button className="current-project" onClick={() => chooseTable(null)}>
              <EntityIcon name={project.icon} fallback="folder" />
              {project.name}
              <ChevronRightIcon />
            </button>
            <div className="sidebar-heading table-heading">
              <span>{tr('数据表')}</span>
              <IconButton
                variant="ghost"
                size="1"
                color="gray"
                aria-label={tr('创建数据表')}
                onClick={onCreateTable}
              >
                <PlusIcon />
              </IconButton>
            </div>
            <div className="table-nav" ref={reorder.containerRef}>
              {projectTables.map((t) => (
                <div key={t.id} className="table-nav-item" {...reorder.itemProps(t.id)}>
                  <button
                    className={tableId === t.id ? 'active' : ''}
                    onClick={() => chooseTable(t.id)}
                    title={t.name}
                  >
                    <EntityIcon name={t.icon} />
                    <span>{t.name}</span>
                    <span className="nav-count">{t.recordCount}</span>
                  </button>
                  <button {...reorder.handleProps(t.id, t.name)}>
                    <DragHandleDots2Icon />
                  </button>
                </div>
              ))}
              <button className="new-table-nav" onClick={onCreateTable}>
                <PlusIcon />
                <span>{tr('新建数据表')}</span>
              </button>
            </div>
          </>
        ) : (
          <div className="project-nav">
            {projects.map((p) => (
              <button key={p.id} onClick={() => chooseProject(p.id)}>
                <EntityIcon name={p.icon} fallback="folder" />
                <span>{p.name}</span>
              </button>
            ))}
            {projects.length === 0 && <p className="sidebar-empty">{tr('你的项目会出现在这里')}</p>}
          </div>
        )}
        <div className="sidebar-bottom">
          <button onClick={onExtensions}>
            <CubeIcon />
            <span>{tr('扩展')}</span>
            <span className="nav-count">{extensionCount}</span>
          </button>
          <div className="local-status">
            <span className={health ? 'status-dot' : 'status-dot offline'} />
            {health ? tr('本地运行') : tr('等待连接')}
            <span className="version-tag">v0.1</span>
          </div>
        </div>
        <ResizeHandle
          className="sidebar-resize"
          label={tr('调整侧栏宽度')}
          value={width}
          min={200}
          max={400}
          defaultValue={238}
          onChange={(w) => layout.change('sidebar', w)}
          onCommit={(w) => layout.commit('sidebar', w)}
        />
      </aside>
    </>
  )
}
export function Topbar({
  collapsed,
  onToggle,
  project,
  table,
  chooseProject,
  chooseTable,
  onExtensions,
  onBuild,
  onManageProject,
}: {
  collapsed: boolean
  onToggle: () => void
  project?: Project
  table?: TableDef
  chooseProject: (id: string | null) => void
  chooseTable: (id: string | null) => void
  onExtensions: () => void
  onBuild: () => void
  onManageProject: () => void
}) {
  useLocale()
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <IconButton
          variant="ghost"
          color="gray"
          className="sidebar-toggle"
          aria-label={collapsed ? tr('展开侧栏') : tr('收起侧栏')}
          title={collapsed ? tr('展开侧栏') : tr('收起侧栏')}
          aria-expanded={!collapsed}
          aria-controls="project-sidebar"
          onClick={onToggle}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9 4v16" />
            {collapsed ? <path d="m13 9 3 3-3 3" /> : <path d="m16 9-3 3 3 3" />}
          </svg>
        </IconButton>
        <button onClick={() => chooseProject(null)}>{tr('项目')}</button>
        {project && (
          <>
            <ChevronRightIcon />
            <button onClick={() => chooseTable(null)}>{project.name}</button>
          </>
        )}
        {table && (
          <>
            <ChevronRightIcon />
            <span>{table.name}</span>
          </>
        )}
      </div>
      <div className="topbar-actions">
        {project && (
          <Button size="1" variant="ghost" color="gray" onClick={onManageProject}>
            {tr('项目管理')}
          </Button>
        )}
        <Button size="1" variant="soft" color="gray" onClick={onBuild}>
          {tr('从结构创建')}
        </Button>
        <IconButton variant="ghost" color="gray" aria-label={tr('查看扩展')} onClick={onExtensions}>
          <GearIcon />
        </IconButton>
        <PreferenceControls />
      </div>
    </header>
  )
}
