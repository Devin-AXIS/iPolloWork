import { request } from './api.ts'
import type { DesignTemplateSource } from '../shared/design-templates.ts'

/** List only published grants; each use is reauthorized by the organization service. */
export function organizationTemplateSource(signal: AbortSignal, title: string): DesignTemplateSource {
  return {
    id: 'organization', title,
    async list(caller) {
      const result = await request<{ items: { id: string; enterpriseId: string; title: string; description: string; version: string; sourceName: string }[] }>(
        '/enterprise/design-templates', { signal: caller ? AbortSignal.any([caller, signal]) : signal }).catch(error => {
          if (error instanceof Error && error.message === 'IPW_SIGN_IN_REQUIRED') return { items: [] }
          throw error
        })
      return result.items.map(item => ({ ...item, id: `organization.${item.enterpriseId}.${item.id}` }))
    },
    async read(id, version) {
      const match = /^organization\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(id)
      if (!match) throw Error('IPW_INVALID_INPUT')
      const result = await request<{ html: string }>(`/enterprise/design-templates/${match[1]}/${match[2]}/${encodeURIComponent(version)}`, { signal })
      return result.html
    },
  }
}
