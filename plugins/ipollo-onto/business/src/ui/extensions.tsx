import { translate as tr, useLocale } from './i18n'
import { useState } from 'react'
import { Badge, Button, Tabs } from '@radix-ui/themes'
import { CubeIcon } from '@radix-ui/react-icons'
import { Modal, ErrorNotice, LoadingState } from './components/primitives'
import { useExtensions } from './extension-context'
import { message } from './api'
import { extensionCategories, type ExtensionCategory } from '../core/extensions'
import { PluginImport } from './plugin-import'

export function ExtensionsDialog({ onClose }: { onClose: () => void }) {
  useLocale()
  const { extensions, error: loadError, loading, change } = useExtensions()
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const [category, setCategory] = useState<ExtensionCategory | 'all'>('all')
  const visible = extensions.filter((e) => category === 'all' || e.categories?.includes(category))
  async function run(id: string, action: string) {
    setBusy(id)
    setError('')
    try {
      await change(id, action)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <Modal
      title={tr('扩展')}
      description={tr('按需启用当前数据库中的能力，同库项目共享配置。停用不会删除业务数据。')}
      open
      onClose={busy ? () => undefined : onClose}
      wide
    >
      <ErrorNotice error={error || loadError} />
      <PluginImport
        disabled={Boolean(busy) || loading}
        onBusy={(value) => setBusy(value ? 'import' : '')}
        onImported={() => setCategory('all')}
      />
      <Tabs.Root
        value={category}
        onValueChange={(value) => {
          setCategory(value as ExtensionCategory | 'all')
          setError('')
        }}
      >
        <Tabs.List aria-label={tr('扩展分类')} className="extension-categories">
          <Tabs.Trigger value="all">{tr('全部')}</Tabs.Trigger>
          {extensionCategories.map((item) => (
            <Tabs.Trigger key={item.id} value={item.id}>
              {tr(item.name)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={category}>
          {loading ? (
            <LoadingState>{tr('正在读取扩展…')}</LoadingState>
          ) : (
            <div className="extension-list">
              {visible.map((e) => (
                <div key={e.id}>
                  <span className="extension-icon">
                    <CubeIcon />
                  </span>
                  <div className="extension-copy">
                    <b>{tr(e.name)}</b>
                    <p>{tr(e.description)}</p>
                    {e.loadError && <ErrorNotice error={e.loadError} />}
                    <small>
                      v{e.installedVersion ?? e.version}
                      {e.usedBy > 0 ? tr(' · {0} 个字段在使用', { 0: e.usedBy }) : ''}
                    </small>
                  </div>
                  <div className="extension-actions">
                    <Badge color="gray">
                      {e.loadError
                        ? tr('加载失败')
                        : e.required
                          ? tr('内置')
                          : !e.installedVersion
                            ? tr('可添加')
                            : e.enabled
                              ? tr('已启用')
                              : tr('已停用')}
                    </Badge>
                    {!e.required &&
                      !e.loadError &&
                      (!e.installedVersion ? (
                        <Button
                          size="1"
                          disabled={Boolean(busy)}
                          loading={busy === e.id}
                          onClick={() => run(e.id, 'install')}
                        >
                          {tr('添加')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            disabled={Boolean(busy)}
                            loading={busy === e.id}
                            onClick={() => run(e.id, e.enabled ? 'disable' : 'enable')}
                          >
                            {e.enabled ? tr('停用') : tr('启用')}
                          </Button>
                          {e.installedVersion !== e.version ? (
                            <Button
                              size="1"
                              disabled={Boolean(busy)}
                              onClick={() => run(e.id, 'upgrade')}
                            >
                              {tr('更新到')}
                              {e.version}
                            </Button>
                          ) : null}
                          {!e.enabled ? (
                            <Button
                              size="1"
                              variant="ghost"
                              color="gray"
                              disabled={Boolean(busy)}
                              onClick={() => run(e.id, 'uninstall')}
                            >
                              {tr('移除')}
                            </Button>
                          ) : null}
                        </>
                      ))}
                  </div>
                </div>
              ))}
              {!visible.length && (
                <p className="extension-empty" role="status">
                  {tr('此分类暂无扩展。')}
                </p>
              )}
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </Modal>
  )
}
