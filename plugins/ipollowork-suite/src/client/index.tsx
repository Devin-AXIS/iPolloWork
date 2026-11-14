/** Browser entry: native slots compose the theme, market, and account modules. */
import type { ClientContext } from './native.ts'
import type { SuiteInfo, MarketState } from '../shared/types.ts'
import { request } from './api.ts'
import { labelSource, copy, language } from './locale.ts'
import { mountTheme } from './theme.tsx'
import { MarketPanel } from './market.tsx'
import { AccountPanel, AccountLauncher } from './account.tsx'
import { AccountController } from './account-controller.ts'
import { mountAgents } from './agents.tsx'
import { mountCoordinator } from './coordinator.tsx'
import { mountEnterprise } from './enterprise.tsx'
import { mountDesktopOnboarding } from './desktop-onboarding.ts'
import { mountConnections } from './connections.tsx'
import { callNativeSharing, prepareSharingConnection } from './native-sharing.ts'
import { shareAudienceCopy } from './share-audience-copy.ts'
import { apply as mountIm } from '../../vendor/dsh-im/plugin-src/client/index.js'
export const inject = ['slots', 'theme', 'locale', 'remote', 'layout', 'uiWorkspace', 'connection', 'sessions', 'workspaces', 'contextMenus', 'conversation', 'configForms']
export async function apply(ctx: ClientContext): Promise<void> {
  // Shared pages use their scoped native services; the owner's account UI must not be mounted there.
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'ipollowork-suite: client requests')
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/ipollowork-suite/assets/client.css'
  ctx.effect(() => { document.head.append(link); return () => link.remove() }, 'ipollowork-suite: stylesheet')
  const info = await request<SuiteInfo & { theme: boolean; market: boolean; account: boolean; dedicatedDesktop?: boolean }>('/info', { signal: lifetime.signal })
  if (lifetime.signal.aborted) return
  const labels = labelSource(ctx)
  mountConnections(ctx)
  mountAgents(ctx)
  mountCoordinator(ctx)
  mountIm(ctx)
  if (info.theme) mountTheme(ctx)
  if (info.market) {
    const load = (signal: AbortSignal) => request<MarketState>(`/catalog?language=${language(ctx)}`, { signal })
    const subscribeChanges = (listener: () => void) => ctx.remote.$on('plugin-manager/changed', listener)
    ctx.slots.inject('plugins.tab', () => ctx.slots.register({ name: 'plugins.tab', id: 'ipollowork-market', order: -10, label: () => copy(ctx).market,
      inject: () => ({ load, subscribeChanges, hooks: { labels } }),
    }, MarketPanel))
  }
  if (info.account) {
    const account = new AccountController()
    ctx.effect(() => {
      const refresh = () => { void account.refresh() }
      const visible = () => { if (document.visibilityState === 'visible') refresh() }
      window.addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', visible)
      return () => {
        window.removeEventListener('focus', refresh)
        document.removeEventListener('visibilitychange', visible)
      }
    }, 'ipollowork-suite: refresh account on return')
    ctx.on('liveshare/prepare-owner', async (signal, next) => {
      const previous = await next()
      if (previous.error) return previous
      const t = shareAudienceCopy(language(ctx))
      await account.refresh()
      signal.throwIfAborted()
      const state = account.getSnapshot()
      if (state.error) return { error: t.connectionFailed }
      if (state.account?.status !== 'signed-in') {
        account.openAccountSettings()
        return { error: t.connectionSignIn }
      }
      try {
        await prepareSharingConnection({
          suite: (path, body, signal) => request(path, { method: 'POST', body: JSON.stringify(body), signal }),
          native: callNativeSharing,
        }, AbortSignal.any([signal, lifetime.signal]))
        return { ...previous, connected: true }
      } catch (_error) {
        return { error: t.connectionFailed }
      }
    })
    mountEnterprise(ctx, account)
    ctx.effect(() => () => account.dispose(), 'ipollowork-suite: account state')
    const props = () => ({ origin: info.accountOrigin, refresh: account.refresh, signIn: account.signIn, signUp: account.signUp, signOut: account.signOut, bindSettings: account.bindSettings, hooks: { labels, account } })
    if (info.dedicatedDesktop) {
      document.title = 'iPolloWork'
      ctx.effect(() => ctx.remote.$on('credentials/record-updated', () => { void account.refresh() }),
        'ipollowork-suite: native account changes')
      mountDesktopOnboarding(ctx, account, info.accountOrigin)
    }
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ipollowork-account', order: -20, label: () => copy(ctx).account, inject: props }, AccountPanel))
    ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher', priority: -100, inject: props }, AccountLauncher))
    void account.refresh()
  }
}
