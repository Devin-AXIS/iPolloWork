import type { EntityIconId } from '../core/icons'
import { translate as tr, useLocale } from './i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Badge, Tabs } from '@radix-ui/themes'
import type { Project } from '../core/contracts'
import type { DatabaseSummary, DatabaseCheck } from '../core/database'
import { ErrorNotice, Modal } from './components/primitives'
import { ProjectFields } from './project-fields'
import { api, message } from './api'
import { IntegrationPanel } from './integration-dialog'

export function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project
  onClose: () => void
  onSaved: () => void
}) {
  useLocale()
  const [icon, setIcon] = useState<EntityIconId>(project.icon ?? 'folder')
  const [tab, setTab] = useState('info')
  const [name, setName] = useState(project.name),
    [description, setDescription] = useState(project.description),
    [color, setColor] = useState(project.color)
  const [storage, setStorage] = useState<DatabaseSummary | undefined>(project.storage)
  const [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(''),
    [connectionError, setConnectionError] = useState(''),
    [check, setCheck] = useState<DatabaseCheck>()
  useEffect(() => {
    let active = true
    api<DatabaseSummary>(`/projects/${project.id}/database`)
      .then((s) => {
        if (active) setStorage(s)
      })
      .catch((e) => {
        if (active) setConnectionError(message(e))
      })
    return () => {
      active = false
    }
  }, [project.id])
  async function test() {
    setChecking(true)
    setCheck(undefined)
    setConnectionError('')
    try {
      setCheck(await api<DatabaseCheck>(`/projects/${project.id}/database/test`, 'POST'))
      setStorage((s) => (s ? { ...s, status: 'connected' } : s))
    } catch (e) {
      setConnectionError(message(e))
      setStorage((s) => (s ? { ...s, status: 'unavailable' } : s))
    } finally {
      setChecking(false)
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/projects/${project.id}`, 'PATCH', { name, description, color, icon })
      onSaved()
      onClose()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={tr('项目管理')}
      description={tr('管理项目信息，查看数据存储与连接。')}
      open
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List>
            <Tabs.Trigger value="info">{tr('项目信息')}</Tabs.Trigger>
            <Tabs.Trigger value="database">{tr('数据库')}</Tabs.Trigger>
            <Tabs.Trigger value="integration">API / MCP</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="info" className="project-tab-content form-stack">
            <ProjectFields
              icon={icon}
              onIcon={setIcon}
              name={name}
              description={description}
              color={color}
              onName={setName}
              onDescription={setDescription}
              onColor={setColor}
            />
          </Tabs.Content>
          <Tabs.Content value="database" className="project-tab-content">
            <section className="project-database-summary" aria-label={tr('数据库连接')}>
              <div className="database-summary-heading">
                <b>{tr('项目数据库')}</b>
                <Badge color="gray">
                  {storage?.mode === 'independent' ? tr('独立存储') : tr('默认存储')}
                </Badge>
              </div>
              {storage ? (
                <>
                  <dl>
                    <div>
                      <dt>{tr('类型')}</dt>
                      <dd>{storage.engine === 'sqlite' ? 'SQLite' : storage.engine === 'highgo' ? tr('瀚高 · 兼容连接') : 'PostgreSQL'}</dd>
                    </div>
                    <div>
                      <dt>{tr('数据库')}</dt>
                      <dd>{storage.database}</dd>
                    </div>
                    <div>
                      <dt>{tr('地址')}</dt>
                      <dd>
                        {storage.engine === 'sqlite' ? tr('本机') : `${storage.host}:${storage.port}`}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr('账号')}</dt>
                      <dd>{storage.user}</dd>
                    </div>
                    <div>
                      <dt>{tr('状态')}</dt>
                      <dd>
                        {storage.status === 'connected'
                          ? tr('已连接')
                          : storage.status === 'pending'
                            ? tr('等待完成初始化')
                            : tr('暂时无法连接')}
                      </dd>
                    </div>
                  </dl>
                  <p className="form-hint">
                    {storage.mode === 'independent'
                      ? tr('表、记录、关联及扩展配置保存在这个数据库中。')
                      : tr('使用当前服务的数据库，同库项目之间可以直接关联。')}{' '}
                    {tr('更换存储需要迁移，当前版本不直接切换。')}
                  </p>
                </>
              ) : (
                <p className="form-hint">{tr('正在读取连接信息…')}</p>
              )}
              <div className="database-check">
                <Button
                  type="button"
                  color="gray"
                  variant="soft"
                  size="1"
                  onClick={test}
                  loading={checking}
                >
                  {tr('检查连接')}
                </Button>
                {check && (
                  <span role="status">
                    {tr('连接正常 ·')}
                    {check.latencyMs} ms
                  </span>
                )}
              </div>
              <ErrorNotice error={connectionError} />
            </section>
          </Tabs.Content>
          <Tabs.Content value="integration" className="project-tab-content">
            <IntegrationPanel scope={{ kind: 'project', id: project.id }} />
          </Tabs.Content>
        </Tabs.Root>
        <ErrorNotice error={error} />
        {tab !== 'integration' && (
          <div className="form-actions">
            <Button type="button" color="gray" variant="soft" onClick={onClose}>
              {tr('取消')}
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              {tr('保存修改')}
            </Button>
          </div>
        )}
      </form>
    </Modal>
  )
}
