import type { EntityIconId } from '../../core/icons'
import type { RecordQuery } from '../../core/query'
import { emptyQuery } from '../../core/query'
import { QueryControls, QuerySummary } from './query-controls'
import { IconPicker, FieldTypeIcon } from './icons'
import { translate as tr, useLocale } from '../i18n'
import { Suspense, useState } from 'react'
import { SearchInput, LoadingState } from './primitives'
import { Button, DropdownMenu, IconButton, Spinner, Tabs } from '@radix-ui/themes'
import {
  ArrowTopRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DotsHorizontalIcon,
  DownloadIcon,
  InfoCircledIcon,
  Link2Icon,
  PlusIcon,
  Cross2Icon,
  FileTextIcon,
  ReloadIcon,
  Pencil1Icon,
  EyeOpenIcon,
} from '@radix-ui/react-icons'
import type { Project } from '../../core/contracts'
import { fieldTypes } from '../../core/fields'
import { views, type ViewProps } from '../view-registry'
import { download } from '../api'
import { useExtensions } from '../extension-context'
import { availableContribution } from '../../core/extensions'

export function TableWorkspace({
  data,
  exploration,
  onExplorationQuery,
  view,
  infoOpen,
  query,
  page,
  loading,
  onViewChange,
  onToggleInfo,
  onQueryChange,
  onPageChange,
  onSchema,
  onAutomation,
  onIntegration,
  onDeleteTable,
  onOpen,
  onAdd,
  onCreateRecord,
  onUpdateRecord,
  onAddField,
  onEditField,
  onOpenLinked,
  onReorderFields,
  onIconChange,
  iconBusy,
  apiLoading,
  onApiRefresh,
  selection,
  onSelectionChange,
  onViewSaved,
  onCellEditingChange,
  onCellSaved,
}: ViewProps & {
  selection: RecordQuery
  onSelectionChange: (query: RecordQuery, layout?: string) => void
  onViewSaved: () => void
  onIconChange: (icon: EntityIconId) => void
  iconBusy: boolean
  project: Project
  apiLoading: boolean
  onApiRefresh: () => void
  view: string
  infoOpen: boolean
  query: string
  page: number
  loading: boolean
  onViewChange: (value: string) => void
  onToggleInfo: () => void
  onQueryChange: (value: string) => void
  onPageChange: (value: number) => void
  onSchema: () => void
  onAutomation: () => void
  onIntegration: () => void
  onDeleteTable: () => void
}) {
  useLocale()
  const [editMode, setEditMode] = useState(false)
  const { extensions } = useExtensions()
  const availableViews = views
    .list()
    .filter((v) => v.builtIn || availableContribution(extensions, 'views', v.id))
  const activeView = availableViews.find((v) => v.id === view) ?? views.get('grid')
  const CurrentView = activeView.component
  return (
    <div className="table-workspace">
      <Tabs.Root value={activeView.id} onValueChange={onViewChange} className="table-main">
        <div className="table-title-row">
          <div className="table-heading-copy">
            <h1>
              <IconPicker
                value={data.table.icon ?? 'table'}
                onChange={onIconChange}
                disabled={iconBusy}
                label={tr('更换数据表图标')}
              />
              <span title={data.table.name}>{data.table.name}</span>
            </h1>
          </div>
          <div className="table-title-actions">
            <IconButton
              color="gray"
              variant="ghost"
              aria-label={tr('查看数据结构')}
              onClick={onToggleInfo}
            >
              <InfoCircledIcon />
            </IconButton>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton color="gray" variant="ghost" aria-label={tr('数据表操作')}>
                  <DotsHorizontalIcon />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item
                  onSelect={() =>
                    download(tr('{0}-当前结果.json', { 0: data.table.name }), {
                      fields: data.fields,
                      records: data.records,
                    })
                  }
                >
                  <DownloadIcon />
                  {tr('导出当前结果')}
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={onSchema}>
                  <FileTextIcon />
                  {tr('查看 AI 数据结构')}
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={onAutomation}>{tr('自动化')}</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={onIntegration}>
                  <Link2Icon />
                  API / MCP
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item color="red" onSelect={onDeleteTable}>
                  {tr('删除数据表')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
        <div className="view-bar">
          <Tabs.List className="view-tabs" aria-label={tr('数据视图')}>
            {availableViews.map((v) => (
              <Tabs.Trigger
                value={v.id}
                key={v.id}
                className={activeView.id === v.id ? 'active' : ''}
              >
                <v.icon />
                {tr(v.name)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <button
            className="view-info"
            onClick={onSchema}
            aria-label={tr('AI 数据结构')}
            title={tr('AI 数据结构')}
          >
            <FileTextIcon />
            {tr('AI 数据结构')}
          </button>
        </div>
        <div className="table-toolbar">
          <div className="toolbar-query">
            <SearchInput
              value={query}
              onChange={(value) => {
                onQueryChange(value)
                onPageChange(1)
              }}
              label={tr('搜索记录')}
              placeholder={tr('按名称前缀搜索')}
            />
            <QueryControls
              data={data}
              selection={selection}
              layout={view}
              onChange={onSelectionChange}
              onSaved={onViewSaved}
            />
          </div>
          <div className="toolbar-right">
            {activeView.id === 'grid' && (
              <Button
                variant={editMode ? 'soft' : 'ghost'}
                color="gray"
                aria-pressed={editMode}
                aria-label={tr('表格编辑模式')}
                onClick={() => setEditMode((v) => !v)}
              >
                {editMode ? <Pencil1Icon /> : <EyeOpenIcon />}
                {editMode ? tr('编辑模式') : tr('查看模式')}
              </Button>
            )}
            {data.fields.some((f) => f.source) && (
              <Button
                variant="ghost"
                color="gray"
                onClick={onApiRefresh}
                loading={apiLoading}
                aria-label={tr('更新当前页 API')}
                title={tr('更新当前页 API')}
              >
                <ReloadIcon />
                {tr('更新 API')}
              </Button>
            )}
            <Button variant="ghost" color="gray" onClick={onAddField}>
              <PlusIcon />
              {tr('字段')}
            </Button>
            <Button onClick={onAdd}>
              <PlusIcon />
              {tr('新建记录')}
            </Button>
          </div>
        </div>
        <QuerySummary
          data={data}
          onClear={() => onSelectionChange({ ...emptyQuery(), search: selection.search })}
        />
        <Tabs.Content
          value={activeView.id}
          className={`view-content ${loading ? 'refreshing' : ''}`}
        >
          <Suspense fallback={<LoadingState>{tr('正在打开视图…')}</LoadingState>}>
            <CurrentView
              key={data.table.id}
              data={data}
              exploration={exploration}
              onExplorationQuery={onExplorationQuery}
              onOpen={onOpen}
              onAdd={onAdd}
              onCreateRecord={onCreateRecord}
              onUpdateRecord={onUpdateRecord}
              onAddField={onAddField}
              onEditField={onEditField}
              onOpenLinked={onOpenLinked}
              onReorderFields={onReorderFields}
              editMode={editMode}
              onCellEditingChange={onCellEditingChange}
              onCellSaved={onCellSaved}
            />
          </Suspense>
        </Tabs.Content>
        <div className="table-footer">
          <span>
            {data.total} {tr('条记录')}
            <span className="dot-separator">·</span>
            {data.fields.length} {tr('个字段')}
            {loading && <Spinner size="1" />}
          </span>
          <div>
            <span>
              {tr('第 {0} / {1} 页', { 0: page, 1: Math.max(1, Math.ceil(data.total / 50)) })}
            </span>
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              aria-label={tr('上一页')}
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              aria-label={tr('下一页')}
              disabled={page * 50 >= data.total}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRightIcon />
            </IconButton>
          </div>
        </div>
      </Tabs.Root>
      {infoOpen && (
        <aside className="context-panel">
          <div className="context-title">
            <b>{tr('数据结构')}</b>
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              aria-label={tr('关闭数据结构')}
              onClick={onToggleInfo}
            >
              <Cross2Icon />
            </IconButton>
          </div>
          <p>{tr('字段描述信息，关联让信息形成业务。')}</p>
          <div className="context-stats">
            <div>
              <b>{data.fields.length}</b>
              <span>{tr('字段')}</span>
            </div>
            <div>
              <b>{data.fields.filter((f) => f.type === 'relation').length}</b>
              <span>{tr('关联')}</span>
            </div>
          </div>
          <div className="context-fields">
            {data.fields.map((f) => (
              <div key={f.id}>
                <span>
                  <FieldTypeIcon type={f.type} source={f.source} />
                  {onEditField ? (
                    <button
                      className="field-edit"
                      onClick={() => onEditField(f)}
                      aria-label={tr('编辑字段 {0}', { 0: f.name })}
                    >
                      {f.name}
                    </button>
                  ) : (
                    f.name
                  )}
                </span>
                <small>
                  {f.source
                    ? tr('API · {0}', {
                        0: f.source.storage === 'snapshot' ? tr('获取并保存') : tr('动态读取'),
                      })
                    : f.type === 'relation'
                      ? f.multiple
                        ? tr('多条关联')
                        : tr('单条关联')
                      : fieldTypes.has(f.type)
                        ? tr(fieldTypes.get(f.type).label)
                        : tr('扩展未加载')}
                </small>
              </div>
            ))}
          </div>
          <Button size="2" variant="soft" onClick={onAddField}>
            <PlusIcon />
            {tr('添加字段')}
          </Button>
          <div className="context-note">
            <FileTextIcon />
            <b>{tr('为 AI 提供清晰的上下文')}</b>
            <p>{tr('导出表、字段和关系定义，让 AI 使用确定的数据结构。')}</p>
            <button onClick={onSchema}>
              {tr('查看数据结构')}
              <ArrowTopRightIcon />
            </button>
          </div>
        </aside>
      )}
    </div>
  )
}
