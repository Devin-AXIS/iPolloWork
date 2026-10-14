import { translate as tr, useLocale } from './i18n'
import { useEffect, useState } from 'react'
import { Button, TextArea } from '@radix-ui/themes'
import { CopyIcon, DownloadIcon, Link2Icon } from '@radix-ui/react-icons'
import type { IntegrationInfo, IntegrationScope } from '../core/integration'
import { api, download, message } from './api'
import { ErrorNotice, FormLabel, LoadingState, Modal } from './components/primitives'

export function IntegrationPanel({ scope }: { scope: IntegrationScope }) {
  useLocale()
  const [info, setInfo] = useState<IntegrationInfo>()
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [revision, setRevision] = useState(0)
  const path = `/${scope.kind}s/${scope.id}`
  useEffect(() => {
    let active = true
    setInfo(undefined)
    setError('')
    api<IntegrationInfo>(`${path}/integration`)
      .then((result) => {
        if (active) setInfo(result)
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [path, revision])

  async function copy(label: string, value: string) {
    setError('')
    setCopied('')
    try {
      await navigator.clipboard.writeText(value)
      setCopied(tr('已复制{0}', { 0: label }))
    } catch {
      setError(tr('浏览器未允许复制，可展开下方说明手动选择。'))
    }
  }
  async function exportApi() {
    setError('')
    try {
      download(`${info?.scope.name}-openapi.json`, await api(`${path}/openapi.json`))
    } catch (e) {
      setError(message(e))
    }
  }
  if (!info)
    return error ? (
      <div className="form-stack">
        <ErrorNotice error={error} />
        <Button type="button" variant="soft" onClick={() => setRevision((v) => v + 1)}>
          {tr('重新加载')}
        </Button>
      </div>
    ) : (
      <LoadingState>{tr('正在读取接入信息…')}</LoadingState>
    )
  return (
    <div className="integration-panel form-stack">
      <p className="form-hint">
        {scope.kind === 'project'
          ? tr('连接这个项目，AI 可以读取各表、沿关联查询，也可以创建新的业务结构。')
          : tr('连接这张表，AI 可以查询和更新记录。跨表分析请使用项目的连接。')}
      </p>
      <FormLabel label={tr('MCP 连接地址')}>
        <TextArea
          readOnly
          value={info.urls.mcp}
          rows={3}
          onFocus={(e) => e.target.select()}
          className="integration-url"
        />
      </FormLabel>
      <div className="integration-actions">
        <Button
          type="button"
          onClick={() => copy(tr('MCP 配置'), JSON.stringify(info.mcpConfig, null, 2))}
        >
          <CopyIcon />
          {tr('复制 MCP 配置')}
        </Button>
        <Button
          type="button"
          color="gray"
          variant="soft"
          onClick={() => copy(tr('AI 说明'), info.instructions)}
        >
          <CopyIcon />
          {tr('复制 AI 说明')}
        </Button>
      </div>
      <p className="form-hint">
        {tr(
          '用于本机的 iPolloWork 或支持 HTTP MCP 的客户端。AI 说明包含当前表结构、关联和可用操作。',
        )}
      </p>
      {copied && (
        <p className="form-hint" role="status">
          {copied}
        </p>
      )}
      <ErrorNotice error={error} />
      <details className="integration-details">
        <summary>
          {tr('可用操作 ·')}
          {info.tools.length}
        </summary>
        <ul>
          {info.tools.map((tool) => (
            <li key={tool.name}>
              <div>
                <b>{tr(tool.title)}</b>
                <span>{tool.readOnly ? tr('读取') : tr('写入')}</span>
              </div>
              <p>{tr(tool.description)}</p>
            </li>
          ))}
        </ul>
      </details>
      <details className="integration-details">
        <summary>{tr('配置与 API 文档')}</summary>
        <pre tabIndex={0} aria-label={tr('MCP 配置')}>
          {JSON.stringify(info.mcpConfig, null, 2)}
        </pre>
        <div className="integration-actions">
          <Button type="button" color="gray" variant="soft" size="1" onClick={exportApi}>
            <DownloadIcon />
            {tr('下载 OpenAPI')}
          </Button>
          <Button
            type="button"
            color="gray"
            variant="ghost"
            size="1"
            onClick={() => copy(tr('API 地址'), info.urls.operations)}
          >
            <Link2Icon />
            {tr('复制 API 地址')}
          </Button>
        </div>
        <details>
          <summary>{tr('查看 AI 说明')}</summary>
          <pre tabIndex={0} aria-label={tr('AI 说明')}>
            {info.instructions}
          </pre>
        </details>
      </details>
    </div>
  )
}

export function IntegrationDialog({
  scope,
  onClose,
}: {
  scope: IntegrationScope
  onClose: () => void
}) {
  useLocale()
  return (
    <Modal
      title="API / MCP"
      description={tr('让 AI 与工具直接使用这张表。')}
      open
      onClose={onClose}
    >
      <IntegrationPanel scope={scope} />
    </Modal>
  )
}
