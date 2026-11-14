/** One source selector shared by all plugin credential editors. */
import { useEffect, useState } from 'react'
import type { ServiceCatalog, ServiceChoice } from '../shared/services.ts'
import { request } from './api.ts'
import css from './suite.module.css'
export type ServiceState = {
  catalog: ServiceCatalog
  choices: Record<string, ServiceChoice>
  models?: { status: string }
}
type State = ServiceState
export function ServiceSource({
  provider,
  zh,
  children,
  ownConfigured = false,
}: {
  provider: string
  zh: boolean
  ownConfigured?: boolean
  children: React.ReactNode
}) {
  const [state, setState] = useState<State>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void request<State>('/services', { signal: controller.signal }).then(
      setState,
      () => {
        if (!controller.signal.aborted)
          setError(zh ? '无法读取官方服务' : 'Could not load official services')
      },
    )
    return () => controller.abort()
  }, [provider, zh])
  const available =
      state?.catalog.items.filter((s) => s.provider === provider) ?? [],
    choice = state?.choices[provider]
  const selected =
    choice?.source === 'official'
      ? choice.serviceId
      : choice?.source === 'own'
        ? 'own'
        : ownConfigured
          ? 'own'
          : (available.find((s) => s.available)?.id ?? 'own')
  const save = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const choice: ServiceChoice =
        id === 'own' ? { source: 'own' } : { source: 'official', serviceId: id }
      await request('/services/choice', {
        method: 'POST',
        body: JSON.stringify({ provider, choice }),
      })
      setState((s) =>
        s ? { ...s, choices: { ...s.choices, [provider]: choice } } : s,
      )
      window.dispatchEvent(new Event('ipollo-service-changed'))
    } catch {
      setError(zh ? '未能切换服务' : 'Could not change source')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <label className={css.serviceSource}>
        {zh ? '服务来源' : 'Service source'}
        <select
          disabled={busy || !state}
          value={selected}
          onChange={(e) => void save(e.target.value)}
        >
          {selected !== 'own' && !available.some((s) => s.id === selected) && (
            <option value={selected} disabled>
              {zh ? '已选官方服务不可用' : 'Selected service unavailable'}
            </option>
          )}
          <option value="own">
            {zh ? '使用自己的 Key' : 'Use my own key'}
          </option>
          {available.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.available}>
              {s.title}
              {s.available ? '' : zh ? ' · 当前不可用' : ' · Unavailable'}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {selected === 'own' ? (
        children
      ) : (
        <p className={css.muted}>
          {zh
            ? '使用 iPolloWork 官方服务，按账户套餐和额度结算。'
            : 'Uses your iPolloWork plan and balance.'}
        </p>
      )}
    </>
  )
}
export function useServiceState(zh: boolean) {
  const [state, setState] = useState<State>(),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      void request<State>('/services', { signal: controller.signal }).then(
        (value) => {
          setState(value)
          setError('')
        },
        () => {
          if (!controller.signal.aborted)
            setError(
              zh ? '官方服务暂时不可用' : 'Official services unavailable',
            )
        },
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
  }, [zh])
  return { state, error }
}
export function OfficialServices({
  zh,
  state,
  error,
}: {
  zh: boolean
  state: ServiceState | undefined
  error: string
}) {
  return (
    <div className={css.connectionList}>
      {error ? (
        <p role="alert">{error}</p>
      ) : state?.catalog.items.length ? (
        <>
          <p className={css.muted}>
            {zh ? '官方服务 · 可用积分 ' : 'Official services · Credits '}
            {state.catalog.points}
          </p>
          {state.catalog.items.map((s) => (
            <div key={s.id} className={css.connectionRow}>
              <span>
                <strong>{s.title}</strong>
                <small>{s.capabilities.join(' · ')}</small>
              </span>
              <span className={css.connectionStatus}>
                {s.available
                  ? zh
                    ? '可用'
                    : 'Available'
                  : zh
                    ? '当前不可用'
                    : 'Unavailable'}
              </span>
            </div>
          ))}
        </>
      ) : (
        <p className={css.muted}>
          {zh
            ? '登录后显示账户可用的官方服务；也可以使用自己的 Key。'
            : 'Sign in to see official services, or use your own key.'}
        </p>
      )}
      {state?.models?.status === 'error' && (
        <p role="alert">
          {zh
            ? '官方模型暂时不可用，请稍后重试。'
            : 'Official models are temporarily unavailable.'}
        </p>
      )}
    </div>
  )
}
