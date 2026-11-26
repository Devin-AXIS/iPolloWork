import { useEffect, useState, useSyncExternalStore } from 'react'
import { DetailDocument, useDetailDocumentLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ClientContext } from './native.ts'
import { request } from './api.ts'
import { language } from './locale.ts'

type LocalizedDocument = { markdown?: string; path?: string }

function LocalizedPluginDocument({ subject, ctx }: PluginDetailProps & { ctx: ClientContext }) {
  const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => language(ctx))
  const pkg = subject.kind === 'bundle' && subject.pkg.availability !== 'missing' ? subject.pkg : undefined
  const name = pkg?.name
  const version = pkg?.version
  const key = JSON.stringify([name, version, locale])
  const [settled, setSettled] = useState<{ key: string; document: LocalizedDocument }>()
  useEffect(() => {
    if (!name) return
    const controller = new AbortController()
    const query = new URLSearchParams({ name, language: locale })
    void request<LocalizedDocument>(`/plugin-detail?${query}`, { signal: controller.signal })
      .catch((): LocalizedDocument => ({}))
      .then(document => { if (!controller.signal.aborted) setSettled({ key, document }) })
    return () => controller.abort()
  }, [key, name, locale])

  const t = ctx.locale.bind('pluginManager')
  const labels = useDetailDocumentLabels({
    title: t('detailTitle'), loading: t('detailLoading'), retry: t('retry'),
    copy: t('copy'), copied: t('copied'), codeBlock: t('codeBlock.title'), wrap: t('codeBlock.wrap'),
    unwrap: t('codeBlock.unwrap'), footnotes: t('detailFootnotes'),
  })
  if (!name) return null
  const document = settled?.key === key ? settled.document : undefined
  if (document?.markdown === undefined && (document !== undefined || locale === 'en')) return null
  const path = document?.path
  const images = path === undefined ? undefined : { resolve(destination: string) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(destination)) return undefined
    const query = new URLSearchParams({ bundle: name, document: path, path: destination })
    return `/api/plugin-manager/detail-file?${query}`
  } }
  return <div data-ipw-localized-plugin-detail>
    <DetailDocument labels={labels} images={images} onRetry={() => {}} state={document?.markdown === undefined
      ? { status: 'loading' } : { status: 'found', markdown: document.markdown }}/>
  </div>
}

export function mountLocalizedPluginDocuments(ctx: ClientContext): void {
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section', id: 'ipollowork-localized-plugin-document', inject: () => ({ ctx }),
  }, LocalizedPluginDocument))
}
