import { translate as tr, useLocale } from './i18n'
import { useState } from 'react'
import { Button, TextArea, Tabs, Badge } from '@radix-ui/themes'
import { Modal, ErrorNotice } from './components/primitives'
import { api, message, download } from './api'
import { exampleBlueprint } from '../core/blueprint-example'
import type { BlueprintResult } from '../core/blueprint'

export function BlueprintDialog({
  projectId,
  schema,
  onClose,
  onCreated,
}: {
  projectId?: string
  schema?: unknown
  onClose: () => void
  onCreated: (result: BlueprintResult) => void
}) {
  useLocale()
  const [text, setText] = useState(() => JSON.stringify(exampleBlueprint(projectId), null, 2)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [preview, setPreview] = useState<BlueprintResult | null>(null),
    [tab, setTab] = useState(schema ? 'current' : 'build')
  async function run(apply: boolean) {
    setBusy(true)
    setError('')
    try {
      const result = await api<BlueprintResult>(
        `/blueprints/${apply ? 'apply' : 'preview'}`,
        'POST',
        JSON.parse(text),
      )
      if (apply) {
        onCreated(result)
        onClose()
      } else setPreview(result)
    } catch (e) {
      setError(message(e))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={tr('数据结构')}
      description={tr(
        '可直接使用 iPolloWork AI 生成的结构建表，也可以继续手动编辑。当前尚未连接宿主 AI。',
      )}
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      wide
    >
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List>
          <Tabs.Trigger value="build">{tr('从结构创建')}</Tabs.Trigger>
          {schema ? <Tabs.Trigger value="current">{tr('当前结构')}</Tabs.Trigger> : null}
        </Tabs.List>
        <Tabs.Content value="build" className="blueprint-body">
          <p className="form-hint">
            {tr('粘贴结构 JSON，先预览新增的表与字段。这里只新增结构，不覆盖已有数据。')}
          </p>
          <TextArea
            className="blueprint-editor"
            aria-label={tr('构建数据结构')}
            rows={13}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value)
              setPreview(null)
              setError('')
            }}
          />
          <ErrorNotice error={error} />
          {preview ? (
            <div className="blueprint-result" role="status">
              <b>{preview.replayed ? tr('这份请求已经执行过') : tr('将创建以下数据表')}</b>
              {preview.tables.map((t) => (
                <div key={t.key}>
                  <span>{t.name}</span>
                  <Badge color="gray">
                    {Object.keys(t.fieldIds).length} {tr('个字段')}
                  </Badge>
                </div>
              ))}
              <small>{tr('关联会同时建立反向字段。')}</small>
            </div>
          ) : null}
          <div className="form-actions">
            <Button variant="soft" color="gray" disabled={busy} onClick={() => run(false)}>
              {tr('预览结构')}
            </Button>
            <Button disabled={busy || !preview} loading={busy} onClick={() => run(true)}>
              {preview?.replayed ? tr('打开已创建项目') : tr('创建数据结构')}
            </Button>
          </div>
        </Tabs.Content>
        {schema ? (
          <Tabs.Content value="current">
            <pre className="schema-preview">{JSON.stringify(schema, null, 2)}</pre>
            <div className="form-actions">
              <Button variant="soft" color="gray" onClick={() => download('schema.json', schema)}>
                {tr('下载结构')}
              </Button>
            </div>
          </Tabs.Content>
        ) : null}
      </Tabs.Root>
    </Modal>
  )
}
