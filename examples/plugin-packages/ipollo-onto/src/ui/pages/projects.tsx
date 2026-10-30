import { EntityIcon } from '../components/icons'
import { translate as tr, useLocale, getLocale } from '../i18n'
import { PageHeading, SearchInput } from '../components/primitives'
import { Button } from '@radix-ui/themes'
import {
  ArrowTopRightIcon,
  ChevronRightIcon,
  PlusIcon,
  TableIcon,
  Link2Icon,
} from '@radix-ui/react-icons'
import type { Project, TableDef } from '../../core/contracts'

export function ProjectsPage({
  projects,
  query,
  onQueryChange,
  onCreateProject,
  onChooseProject,
  onExample,
  onResearchExample,
  exampleBusy,
}: {
  projects: Project[]
  query: string
  onQueryChange: (value: string) => void
  onCreateProject: () => void
  onChooseProject: (id: string) => void
  onResearchExample: () => void
  onExample: () => void
  exampleBusy: boolean
}) {
  useLocale()
  const filteredProjects = projects.filter((p) =>
    `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="projects-page">
      <PageHeading
        title={tr('你的项目')}
        description={tr('把信息放在一起，让业务连接起来。')}
        before={<div className="eyebrow">WORKSPACE</div>}
        action={
          <Button size="3" onClick={onCreateProject}>
            <PlusIcon />
            {tr('创建项目')}
          </Button>
        }
      />
      <div className="project-toolbar">
        <span>
          {tr('全部项目')}
          <b>{projects.length}</b>
        </span>
        <SearchInput value={query} onChange={onQueryChange} label={tr('搜索项目')} />
      </div>
      {projects.length === 0 ? (
        <div className="welcome">
          <div className="welcome-composition" aria-hidden="true">
            <div className="mini-sheet sheet-back">
              <span />
              <span />
              <span />
            </div>
            <div className="mini-sheet sheet-front">
              <div className="mini-sheet-head">
                <TableIcon />
                <b>{tr('一切，从一张表开始')}</b>
              </div>
              <div className="mini-row">
                <span />
                <i />
              </div>
              <div className="mini-row">
                <span />
                <i />
              </div>
              <div className="mini-row">
                <span />
                <i />
              </div>
            </div>
            <div className="composition-link">
              <Link2Icon />
            </div>
          </div>
          <h2>{tr('留白，是一个好的开始。')}</h2>
          <p>{tr('创建一个项目，建表、整理记录，连接属于你的业务。')}</p>
          <div className="welcome-actions">
            <Button size="3" onClick={onCreateProject}>
              <PlusIcon />
              {tr('创建第一个项目')}
            </Button>
            <Button size="3" variant="ghost" color="gray" onClick={onExample} loading={exampleBusy}>
              {tr('体验示例项目')}
              <ArrowTopRightIcon />
            </Button>
          </div>
        </div>
      ) : (
        <div className="project-grid">
          {filteredProjects.map((p) => (
            <button key={p.id} className="project-card" onClick={() => onChooseProject(p.id)}>
              <div className="project-card-top">
                <span className={`project-icon ${p.color}`}>
                  <EntityIcon name={p.icon} fallback="folder" />
                </span>
                <ArrowTopRightIcon />
              </div>
              <h2>{p.name}</h2>
              <p>{p.description || tr('在这里建立你的表格与业务关系。')}</p>
              <div className="project-card-bottom">
                <span>
                  {p.storage && p.storage.status !== 'connected'
                    ? tr('数据库连接待恢复')
                    : tr('{0} 张表 · {1} 条记录', { 0: p.tableCount, 1: p.recordCount })}
                </span>
                <span>
                  {new Date(p.createdAt).toLocaleDateString(getLocale(), {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </button>
          ))}
          <button className="project-card create-card" onClick={onCreateProject}>
            <span>
              <PlusIcon />
            </span>
            <b>{tr('创建新项目')}</b>
            <p>{tr('给下一个想法，留一个空间')}</p>
          </button>
        </div>
      )}
      <div className="workspace-footer">
        <span>{tr('项目独立组织 · 数据随时可用')}</span>
        <button onClick={onResearchExample} disabled={exampleBusy}>
          {exampleBusy ? tr('准备示例中…') : tr('体验真实 API · 三个示例')}
          <ArrowTopRightIcon />
        </button>
        {projects.length > 0 && (
          <button onClick={onExample} disabled={exampleBusy}>
            {exampleBusy ? tr('准备示例中…') : tr('添加示例项目')}
            <ArrowTopRightIcon />
          </button>
        )}
      </div>
    </div>
  )
}
export function ProjectOverview({
  project,
  tables,
  onCreateTable,
  onChooseTable,
  onManage,
}: {
  project: Project
  tables: TableDef[]
  onCreateTable: () => void
  onChooseTable: (id: string) => void
  onManage: () => void
}) {
  useLocale()
  return (
    <div className="project-overview">
      <PageHeading
        title={project.name}
        description={project.description || tr('从一张表开始，逐步建立你的业务关系。')}
        before={
          <button
            className={`project-icon project-icon-edit ${project.color}`}
            onClick={onManage}
            aria-label={tr('更换项目图标')}
            title={tr('更换项目图标')}
          >
            <EntityIcon name={project.icon} fallback="folder" />
          </button>
        }
        action={
          <Button size="3" onClick={onCreateTable}>
            <PlusIcon />
            {tr('创建数据表')}
          </Button>
        }
      />
      <div className="project-storage-bar">
        <span>
          {project.storage?.mode === 'independent' ? tr('独立数据库') : tr('默认数据库')}
          {project.storage?.database ? ` · ${project.storage.database}` : ''}
          {project.storage && project.storage.status !== 'connected' ? tr(' · 连接待恢复') : ''}
        </span>
        <button className="text-action" onClick={onManage}>
          {tr('管理项目')}
        </button>
      </div>
      {project.storage && project.storage.status !== 'connected' ? (
        <div className="project-empty">
          <h2>{tr('数据库连接待恢复')}</h2>
          <p>{tr('请在项目管理中检查连接，恢复后即可继续使用原有数据。')}</p>
          <Button onClick={onManage}>{tr('检查数据库')}</Button>
        </div>
      ) : tables.length ? (
        <div className="table-list">
          {tables.map((t) => (
            <button key={t.id} onClick={() => onChooseTable(t.id)}>
              <EntityIcon name={t.icon} />
              <div>
                <b>{t.name}</b>
                <span>{t.description || tr('数据表')}</span>
              </div>
              <span>
                {t.recordCount} {tr('条记录')}
              </span>
              <ChevronRightIcon />
            </button>
          ))}
        </div>
      ) : (
        <div className="project-empty">
          <div className="empty-mark">
            <TableIcon />
          </div>
          <h2>{tr('这个项目，等待第一张表')}</h2>
          <p>{tr('客户、商机、产品或项目明细，都可以从这里建立。')}</p>
          <Button onClick={onCreateTable}>
            <PlusIcon />
            {tr('创建数据表')}
          </Button>
        </div>
      )}
    </div>
  )
}
