import { useRef, useState } from 'react'
import { Button, Dialog, DropdownMenu, IconButton } from '@radix-ui/themes'
import { Cross2Icon, DownloadIcon, FileTextIcon } from '@radix-ui/react-icons'
import { translate as tr } from '../i18n'
import { message } from '../api'

export function DocumentExport({
  url,
  disabled,
  prepare,
  onBusy,
  onError,
}: {
  url: string
  disabled: boolean
  prepare: () => Promise<boolean>
  onBusy: (busy: boolean) => void
  onError: (error: string) => void
}) {
  const [preview, setPreview] = useState<{ html: string; title: string }>()
  const [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const exporting = useRef(false)
  async function exportFile(format: 'pdf' | 'docx' | 'html') {
    if (exporting.current) return
    exporting.current = true
    onBusy(true)
    onError('')
    try {
      if (!(await prepare())) return
      const response = await fetch(`${url}?format=${format === 'pdf' ? 'html' : format}`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error((await response.json()).error)
      const encoded = response.headers
        .get('Content-Disposition')
        ?.match(/filename\*=UTF-8''(.+)$/)?.[1]
      const filename = encoded
        ? decodeURIComponent(encoded)
        : `document.${format === 'pdf' ? 'html' : format}`
      if (format === 'pdf') {
        setReady(false)
        setPreview({ html: await response.text(), title: filename.replace(/\.html$/, '') })
      } else {
        const blob = await response.blob(),
          objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = filename
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      }
    } catch (e) {
      onError(message(e))
    } finally {
      exporting.current = false
      onBusy(false)
    }
  }
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            disabled={disabled}
            aria-label={tr('导出文档')}
            title={tr('导出文档')}
          >
            <DownloadIcon />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" size="1">
          <DropdownMenu.Label>{tr('仅导出当前文档')}</DropdownMenu.Label>
          <DropdownMenu.Item onSelect={() => void exportFile('pdf')}>
            <FileTextIcon />
            PDF
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void exportFile('docx')}>
            <FileTextIcon />
            Word (.docx)
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void exportFile('html')}>
            <FileTextIcon />
            HTML
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Dialog.Root
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined)
        }}
      >
        <Dialog.Content className="document-print-dialog">
          <div className="document-print-header">
            <div>
              <Dialog.Title size="3">{tr('导出 PDF')}</Dialog.Title>
              <Dialog.Description size="1" color="gray">
                {tr('仅包含当前文档，使用打印窗口保存为 PDF。')}
              </Dialog.Description>
            </div>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" size="1" aria-label={tr('关闭')}>
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </div>
          {preview && (
            <iframe
              ref={frame}
              title={preview.title}
              srcDoc={preview.html.replace('</style>', 'a{pointer-events:none}</style>')}
              sandbox="allow-same-origin allow-modals"
              onLoad={() => setReady(true)}
            />
          )}
          <div className="document-print-footer">
            <span>{tr('在打印窗口中选择“另存为 PDF”。')}</span>
            <Button
              size="2"
              disabled={!ready}
              onClick={() => {
                frame.current?.contentWindow?.focus()
                frame.current?.contentWindow?.print()
              }}
            >
              <DownloadIcon />
              {tr('保存为 PDF')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  )
}
