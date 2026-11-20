/** Browser entry: native slots compose the theme, market, and account modules. */
import type { ClientContext } from './native.ts'
import type { SuiteInfo, MarketState, MarketEntry } from '../shared/types.ts'
import { request } from './api.ts'
import { labelSource, copy, language } from './locale.ts'
import { mountTheme } from './theme.tsx'
import { mountCurrentVersion } from './desktop-version.tsx'
import { MarketPanel } from './market.tsx'
import { MarketInstallation } from './market-installation.ts'
import { MarketInstallDialog } from './market-install-dialog.tsx'
import { mountAddPlugin } from './add-plugin.ts'
import { AccountPanel, AccountLauncher } from './account.tsx'
import { AccountController } from './account-controller.ts'
import { mountAgents } from './agents.tsx'
import { mountEnterprise } from './enterprise.tsx'
import { mountData } from './data.tsx'
import { createBrowserAppData } from './data-service.ts'
import { mountConnections } from './connections.tsx'
import { mountMcpConnections } from './mcp-connections.tsx'
import { mountOutputContinuationPresentation } from './output-continuation.tsx'
import { mountChatErrors } from './chat-errors.tsx'
import { apply as mountIm } from '../../vendor/dsh-im/plugin-src/client/index.js'
import { callNativeSharing, prepareSharingConnection } from './native-sharing.ts'
import { shareAudienceCopy } from './share-audience-copy.ts'
export const inject = ['slots', 'theme', 'locale', 'remote', 'layout', 'uiWorkspace', 'connection', 'sessions', 'workspaces', 'contextMenus', 'conversation', 'configForms']
export async function apply(ctx: ClientContext): Promise<void> {
  // Shared pages use their scoped native services; the owner's account UI must not be mounted there.
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return
  mountCurrentVersion(ctx)
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'ipollowork-suite: client requests')
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/ipollowork-suite/assets/client.css'
  ctx.effect(() => { document.head.append(link); return () => link.remove() }, 'ipollowork-suite: stylesheet')
  const info = await request<SuiteInfo & { theme: boolean; market: boolean; account: boolean; appData?: boolean; dedicatedDesktop?: boolean }>('/info', { signal: lifetime.signal })
  if (lifetime.signal.aborted) return
  const labels = labelSource(ctx)
  mountOutputContinuationPresentation(ctx)
  mountChatErrors(ctx)
  mountConnections(ctx)
  mountAgents(ctx)
  mountIm(ctx)
  if (info.theme) mountTheme(ctx)
  let enterpriseInstaller: MarketInstallation | undefined
  ctx.inject(['remote.pluginManager'], scope => {
    const load = (signal: AbortSignal) => request<MarketState>(`/catalog?language=${language(ctx)}`, { signal })
    const marketLifetime = new AbortController()
    scope.effect(() => () => marketLifetime.abort(), 'ipollowork-market: client requests')
    const installation = new MarketInstallation(scope.remote.pluginManager, marketLifetime.signal)
    enterpriseInstaller = installation
    scope.effect(() => () => { if (enterpriseInstaller === installation) enterpriseInstaller = undefined }, 'ipollowork: enterprise plugin installer')
    mountAddPlugin(scope, installation.openManual)
    scope.effect(() => scope.remote.$on('plugin-manager/changed', installation.invalidate), 'ipollowork-market: bundle changes')
    scope.effect(() => scope.remote.$on('plugin-manager/install-state', installation.progress), 'ipollowork-market: install progress')
    scope.effect(() => scope.remote.$on('credentials/record-updated', installation.invalidate), 'ipollowork-market: account changes')
    scope.effect(() => scope.on('connection/reset', installation.invalidate), 'ipollowork-market: reconnect')
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'ipollowork-market-install', inject: () => ({ installation, hooks: { labels } }),
    }, MarketInstallDialog))
    if (info.market) scope.slots.inject('plugins.tab', () => scope.slots.register({ name: 'plugins.tab', id: 'ipollowork-market', order: -10, label: () => copy(ctx).market,
      inject: () => ({
        load, installation, hooks: { labels },
        discover: async (source: string) => (await request<{ entries: MarketEntry[] }>('/catalog/discover', { method: 'POST', body: JSON.stringify({ source, language: language(ctx) }) })).entries,
        add: (entry: MarketEntry) => request<void>('/catalog/plugins', { method: 'POST', body: JSON.stringify(entry) }),
      }),
    }, MarketPanel))
  })
  mountMcpConnections(ctx)
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
    const prepareShare = async (signal: AbortSignal) => {
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
        return { connected: true }
      } catch (_error) {
        return { error: t.connectionFailed }
      }
    }
    ctx.provide('ipolloProjectConversationShare', async (input, signal) => {
      const connected = await prepareShare(signal)
      if (!connected.connected) throw new Error('BOARD_SHARE_UNAVAILABLE')
      return request('/enterprise/native-sharing/project-board', {
        method: 'POST', body: JSON.stringify(input), signal: AbortSignal.any([signal, lifetime.signal]),
      })
    })
    mountEnterprise(ctx, account, async spec => {
      if (!enterpriseInstaller) throw new Error('IPW_DSH_PLUGIN_UNAVAILABLE')
      await enterpriseInstaller.startManual(spec, '', spec)
    })
    // App data follows its own entry of the bundle; a change takes effect when the page reloads.
    if (info.appData) {
      mountData(ctx, account)
      ctx.provide('ipolloData', createBrowserAppData())
    }
    ctx.effect(() => () => account.dispose(), 'ipollowork-suite: account state')
    const props = () => ({ refresh: account.refresh, signIn: account.signIn, signUp: account.signUp, signOut: account.signOut, bindSettings: account.bindSettings, hooks: { labels, account } })
    if (info.dedicatedDesktop) {
      const { mountDesktopOnboarding } = await import('./desktop-onboarding.ts')
      document.title = 'iPolloWork'
      ctx.effect(() => ctx.remote.$on('credentials/record-updated', () => { void account.refresh() }),
        'ipollowork-suite: native account changes')
      mountDesktopOnboarding(ctx, account)
    }
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ipollowork-account', order: -20, label: () => copy(ctx).account, inject: props }, AccountPanel))
    ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher', priority: -100, inject: props }, AccountLauncher))
    void account.refresh()
  }
}
