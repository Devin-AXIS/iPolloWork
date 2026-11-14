/** Official-service catalog and per-provider source choice shared by all plugin connection rows. */
import { useCallback, useEffect, useState } from 'react'
import type { OfficialService, ServiceCatalog, ServiceChoice } from '../shared/services.ts'
import { request } from './api.ts'

export type ServiceState = {
  catalog: ServiceCatalog
  choices: Record<string, ServiceChoice>
  models?: { status: string }
}
/** `service` is absent when an explicitly chosen official service is no longer available. */
export type Source = { kind: 'official'; service: OfficialService | undefined } | { kind: 'own' }

/** Read the catalog; refreshes when the account or another view changes a source. */
export function useServiceState() {
  const [state, setState] = useState<ServiceState>(), [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      void request<ServiceState>('/services', { signal: controller.signal }).then(
        value => { setState(value); setFailed(false) },
        () => { if (!controller.signal.aborted) setFailed(true) },
      )
    }
    refresh()
    window.addEventListener('ipollo-account-changed', refresh)
    window.addEventListener('ipollo-service-changed', refresh)
    return () => {
      controller.abort()
      window.removeEventListener('ipollo-account-changed', refresh)
      window.removeEventListener('ipollo-service-changed', refresh)
    }
  }, [])
  /** Persist one provider's source; other mounted views refresh through the change event. */
  const choose = useCallback(async (provider: string, choice: ServiceChoice) => {
    await request('/services/choice', { method: 'POST', body: JSON.stringify({ provider, choice }) })
    setState(current => current ? { ...current, choices: { ...current.choices, [provider]: choice } } : current)
    window.dispatchEvent(new Event('ipollo-service-changed'))
  }, [])
  return { state, failed, choose }
}

/**
 * Resolve the source the Host will use, matching `Services.bind`: an explicit choice wins; without one,
 * an existing personal key stays in use so billing never changes silently; otherwise an available official service is the default.
 */
export function resolveSource(state: ServiceState | undefined, provider: string, ownConfigured: boolean): { source: Source; official: OfficialService | undefined } {
  const services = state?.catalog.items.filter(item => item.provider === provider) ?? []
  const official = services.find(item => item.available)
  const choice = state?.choices[provider]
  if (choice?.source === 'official') {
    const chosen = services.find(item => item.id === choice.serviceId)
    return { source: { kind: 'official', service: chosen?.available ? chosen : undefined }, official }
  }
  if (choice?.source === 'own' || ownConfigured || !official) return { source: { kind: 'own' }, official }
  return { source: { kind: 'official', service: official }, official }
}
