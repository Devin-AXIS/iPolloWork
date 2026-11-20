import { request } from './api.ts'
import type { DesignTemplateSource } from '../shared/design-templates.ts'

/** List only published grants; each use is reauthorized by the organization service. */
export function organizationTemplateSource(signal: AbortSignal, title: string): DesignTemplateSource {
  let releases = new Map<string, { designVersion: string; path: string }>()
  return {
    id: 'organization', title,
    async list(caller) {
      const loading = caller ? AbortSignal.any([caller, signal]) : signal
      const result = await request<{ items: { id: string; enterpriseId: string; title: string; description: string; version: string; designVersion: string; sourceName: string }[] }>(
        '/enterprise/design-templates', { signal: loading }).catch(error => {
          if (error instanceof Error && error.message === 'IPW_SIGN_IN_REQUIRED') return { items: [] }
          throw error
        })
      loading.throwIfAborted()
      const current = new Map<string, { designVersion: string; path: string }>()
      const templates = result.items.map(item => {
        const id = `organization.${item.enterpriseId}.${item.id}`
        current.set(id, {
          designVersion: item.designVersion,
          path: `/enterprise/design-templates/${item.enterpriseId}/${item.id}/${encodeURIComponent(item.version)}`,
        })
        return { id, title: item.title, description: item.description, version: item.designVersion, sourceName: item.sourceName }
      })
      releases = current
      return templates
    },
    async read(id, version) {
      signal.throwIfAborted()
      const release = releases.get(id)
      if (release?.designVersion !== version) throw Error('IPW_INVALID_INPUT')
      const result = await request<{ html: string }>(release.path, { signal })
      signal.throwIfAborted()
      return result.html
    },
  }
}
