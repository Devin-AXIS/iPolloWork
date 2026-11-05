import { translate as tr, useLocale } from './i18n'
import { useRef, useState } from 'react'
import { Button, Badge } from '@radix-ui/themes'
import { UploadIcon } from '@radix-ui/react-icons'
import {
  decodePluginArchive,
  pluginMaxBytes,
  type PluginUpload,
  type PluginImportPreview,
} from '../core/plugin-archive'
import { extensionCategories } from '../core/extensions'
import { useExtensions } from './extension-context'
import { ErrorNotice } from './components/primitives'
import { message } from './api'

export function PluginImport({
  disabled,
  onBusy,
  onImported,
}: {
  disabled: boolean
  onBusy: (busy: boolean) => void
  onImported: () => void
}) {
  useLocale()
  const picker = useRef<HTMLInputElement>(null)
  const { previewImport, importPackage } = useExtensions()
  const [pending, setPending] = useState<{ upload: PluginUpload; preview: PluginImportPreview }>()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')
  function working(value: boolean) {
    setBusy(value)
    onBusy(value)
  }
  async function choose(file?: File) {
    if (!file) return
    setPending(undefined)
    setError('')
    setStatus('')
    working(true)
    try {
      if (!file.name.toLowerCase().endsWith('.zip'))
        throw new Error(tr('请选择 ZIP 格式的 iPollo Onto 插件包'))
      if (file.size > pluginMaxBytes) throw new Error(tr('ZIP 包不能超过 5 MB'))
      const upload = await decodePluginArchive(new Uint8Array(await file.arrayBuffer()))
      setPending({ upload, preview: await previewImport(upload) })
    } catch (e) {
      setError(message(e))
    } finally {
      working(false)
    }
  }
  async function install() {
    if (!pending) return
    setError('')
    working(true)
    try {
      await importPackage(pending.upload)
      setStatus(tr('已导入「{0}」，可在下方管理。', { 0: pending.preview.manifest.name }))
      setPending(undefined)
      onImported()
    } catch (e) {
      setError(message(e))
    } finally {
      working(false)
    }
  }
  return (
    <div className="plugin-import">
      <div className="plugin-import-toolbar">
        <span className="form-hint">{tr('从本地 ZIP 包添加字段或视图')}</span>
        <Button
          size="2"
          variant="soft"
          color="gray"
          disabled={disabled}
          loading={busy}
          onClick={() => picker.current?.click()}
        >
          <UploadIcon />
          {tr('导入插件')}
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".zip,application/zip"
          aria-label={tr('选择插件 ZIP 包')}
          hidden
          onChange={(e) => {
            void choose(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <ErrorNotice error={error} />
      {pending && (
        <div className="plugin-import-preview">
          <div className="plugin-import-title">
            <b>{tr(pending.preview.manifest.name)}</b>
            <Badge color="gray">v{pending.preview.manifest.version}</Badge>
          </div>
          <p>{tr(pending.preview.manifest.description)}</p>
          <p className="form-hint">
            {pending.preview.manifest.categories
              .map((id) => tr(extensionCategories.find((c) => c.id === id)?.name ?? id))
              .join(' · ')}{' '}
            · {pending.preview.fileCount} {tr('个文件 ·')}
            {Math.ceil(pending.preview.bytes / 1024)} KB
            {pending.preview.existing ? tr(' · 已有同一插件，继续将启用它') : ''}
          </p>
          <p className="form-hint">
            {tr('插件会在本机运行，请仅导入可信来源。导入后在当前数据库启用。')}
          </p>
          <div className="plugin-import-actions">
            <Button disabled={disabled} loading={busy} onClick={() => void install()}>
              {tr('导入并启用')}
            </Button>
            <Button
              variant="ghost"
              color="gray"
              disabled={disabled}
              onClick={() => setPending(undefined)}
            >
              {tr('取消')}
            </Button>
          </div>
        </div>
      )}
      {status && (
        <p className="form-hint" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
