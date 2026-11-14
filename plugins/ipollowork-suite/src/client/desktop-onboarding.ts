/** Reuse the native desktop introduction with iPolloWork account state. */
import {
  DesktopOnboardingController, DesktopOnboardingEntry, readOnboardingApiKeyPresence,
  type AccountSnapshot, type DesktopOnboardingInjected, type OnboardingSettings,
} from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type { TranscriptViewMode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ClientContext } from './native.ts'
import type { AccountController } from './account-controller.ts'

/** Keep the original introduction without sharing account credentials.
 * @param ctx - Native client services and slot registration.
 * @param account - iPolloWork account state owner.
 * @param origin - Account service address for account and top-up pages.
 */
export function mountDesktopOnboarding(ctx: ClientContext, account: AccountController, origin: string): void {
  const listeners = new Set<() => void>()
  const read = (): AccountSnapshot => {
    const state = account.getSnapshot()
    const signedIn = state.account?.status === 'signed-in'
    return {
      view: state.account === null ? undefined : {
        status: signedIn ? 'credential-stored' : 'signed-out',
        links: { usageUrl: origin, topUpUrl: origin }, attempt: null,
      },
      details: undefined, avatar: undefined, failed: state.error !== null,
      ...(signedIn && state.account?.status === 'signed-in' && state.account.points !== null
        ? { onboardingCredit: state.account.points > 0 } : {}),
    }
  }
  let snapshot = read()
  const unsubscribe = account.subscribe(() => {
    snapshot = read()
    for (const listener of listeners) listener()
  })
  const source = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const controller = new DesktopOnboardingController(
    ctx.configForms.get<OnboardingSettings>('ui-settings-account'),
    ctx.configForms.get<{ transcriptView?: TranscriptViewMode | null; performanceUsage: 'compact' | 'detailed' }>('ui-chat'),
    enabled => ctx.configForms.developerTools.setEnabled(enabled),
    source, readOnboardingApiKeyPresence, ctx.configForms.describe(),
  )
  ctx.effect(() => () => { controller.dispose(); unsubscribe(); listeners.clear() }, 'ipollowork-suite: desktop introduction')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'ipollowork-desktop-onboarding', locale: 'settings.account',
    inject: () => ({
      hooks: { account: source, onboarding: controller.state },
      setVisible: () => {},
      openPlatformPage: () => { window.open(origin, '_blank', 'noopener,noreferrer'); return () => {} },
      update: change => controller.update(change),
      complete: reason => controller.complete(reason),
      retry: () => controller.retry(),
    } satisfies DesktopOnboardingInjected),
  }, DesktopOnboardingEntry))
}
