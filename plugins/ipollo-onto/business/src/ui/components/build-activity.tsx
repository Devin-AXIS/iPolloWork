import { useEffect, useState } from 'react'
import { CheckIcon, Cross2Icon, ExclamationTriangleIcon, UpdateIcon } from '@radix-ui/react-icons'
import { IconButton } from '@radix-ui/themes'
import type { LiveActivity } from '../../core/live-data'
import { translate as tr, useLocale } from '../i18n'

const labels: Record<string, [string, string]> = {
  schema_preview: ['正在检查结构', '结构检查完成'],
  schema_apply: ['正在建立表与关联', '表与关联已就绪'],
  table_preset_preview: ['正在检查结构', '结构检查完成'],
  table_preset_apply: ['正在建立表与关联', '表与关联已就绪'],
  records_import: ['正在写入数据', '数据已写入'],
  record_create: ['正在添加记录', '记录已添加'],
  record_update: ['正在补充记录', '记录已更新'],
  field_create: ['正在添加字段', '字段已就绪'],
  field_configure: ['正在配置字段', '字段已配置'],
  field_update: ['正在配置字段', '字段已更新'],
  field_delete: ['正在更新工作台', '字段已删除'],
  records_refresh: ['正在获取来源数据', '来源数据已更新'],
  relation_explore: ['正在沿关系查找', '关系查询完成'],
  document_create: ['正在创建文档', '文档已创建'],
  document_update: ['正在更新文档', '文档已更新'],
}
export function BuildActivity({ activities }: { activities: LiveActivity[] }) {
  useLocale()
  const [visible, setVisible] = useState(true)
  const busy = activities.some((a) => a.phase === 'running')
  useEffect(() => {
    setVisible(true)
    if (busy || !activities.length) return
    const timer = setTimeout(() => setVisible(false), 12_000)
    return () => clearTimeout(timer)
  }, [activities, busy])
  if (!visible || !activities.length) return null
  return (
    <aside className="build-activity" aria-label={tr('构建进度')}>
      <div className="build-activity-heading">
        <span className={`build-activity-dot ${busy ? 'active' : ''}`} />
        <span>iPollo Onto</span>
        <IconButton
          size="1"
          color="gray"
          variant="ghost"
          aria-label={tr('收起进度')}
          onClick={() => setVisible(false)}
        >
          <Cross2Icon />
        </IconButton>
      </div>
      <ol aria-live="polite" aria-relevant="additions text">
        {activities.map((a) => {
          const label =
            a.phase === 'failed'
              ? tr('这一步未完成')
              : a.replayed
                ? tr('已恢复先前结果')
                : tr(
                    (labels[a.operation] ?? ['正在更新工作台', '工作台已更新'])[
                      a.phase === 'running' ? 0 : 1
                    ],
                  )
          return (
            <li key={a.id} data-phase={a.phase}>
              {a.phase === 'running' ? (
                <UpdateIcon className="build-activity-spin" />
              ) : a.phase === 'failed' ? (
                <ExclamationTriangleIcon />
              ) : (
                <CheckIcon />
              )}
              <div>
                <span>{label}</span>
                {a.phase === 'complete' && !a.replayed && a.operation === 'records_import' && (
                  <small>
                    {tr('新增 {0} 条 · 更新 {1} 条', { 0: a.created ?? 0, 1: a.updated ?? 0 })}
                  </small>
                )}
                {a.phase === 'complete' &&
                  !a.replayed &&
                  ['schema_apply', 'table_preset_apply'].includes(a.operation) && (
                    <small>{tr('{0} 张表已建立', { 0: a.tables ?? 0 })}</small>
                  )}
              </div>
            </li>
          )
        })}
      </ol>
      {busy && (
        <div className="build-activity-track">
          <span />
        </div>
      )}
    </aside>
  )
}
