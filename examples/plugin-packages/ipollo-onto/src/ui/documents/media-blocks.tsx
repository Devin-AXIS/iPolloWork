import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Button } from '@radix-ui/themes'
import { safeDocumentUrl } from '../../core/documents'
import { translate as tr, useLocale } from '../i18n'

function VideoBlock({ node }: NodeViewProps) {
  useLocale()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [node.attrs.src])
  return (
    <NodeViewWrapper className="document-video-block" contentEditable={false}>
      <video
        src={node.attrs.src}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        aria-label={tr('视频')}
      />
      {failed && <p className="form-hint">{tr('视频暂时无法播放，请检查文件或链接。')}</p>}
    </NodeViewWrapper>
  )
}
export const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: '' } }),
  parseHTML: () => [{ tag: 'video[src]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'video',
    mergeAttributes(HTMLAttributes, { controls: '', playsinline: '', preload: 'metadata' }),
  ],
  addNodeView: () => ReactNodeViewRenderer(VideoBlock),
})
export function MediaInsertPicker({
  kind,
  onUpload,
  onInsert,
}: {
  kind: 'image' | 'video'
  onUpload: () => void
  onInsert: (src: string) => void
}) {
  const [url, setUrl] = useState('')
  const valid = /^https?:\/\//i.test(url.trim()) && safeDocumentUrl(url.trim(), true)
  return (
    <form
      className="document-media-picker"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onInsert(url.trim())
      }}
    >
      <strong>{kind === 'image' ? tr('图片') : tr('视频')}</strong>
      <Button type="button" variant="soft" color="gray" onClick={onUpload}>
        {tr('上传文件')}
      </Button>
      <span>{tr('或使用链接')}</span>
      <input
        aria-label={kind === 'image' ? tr('图片链接') : tr('视频链接')}
        placeholder="https://"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoFocus
      />
      <small>
        {kind === 'video'
          ? tr('支持 MP4、WebM 文件或视频直链。')
          : tr('支持 PNG、JPEG、GIF 和 WebP。')}
      </small>
      <Button type="submit" size="2" disabled={!valid}>
        {tr('插入')}
      </Button>
    </form>
  )
}
