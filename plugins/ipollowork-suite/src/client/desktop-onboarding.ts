/** Reuse the native desktop introduction with iPolloWork account state. */
import { DesktopOnboardingController } from './onboarding/onboarding-state.ts'
import { DesktopOnboardingEntry, type DesktopOnboardingInjected } from './onboarding/DesktopOnboardingEntry.tsx'
import { readOnboardingApiKeyPresence } from './onboarding/onboarding-credentials.ts'
import type { AccountSnapshot } from './onboarding/account.ts'
import type { OnboardingSettings } from './onboarding/settings.ts'
import { onboardingEn, onboardingZh, type AccountKey } from './onboarding/locales.ts'
import { createElement, useSyncExternalStore } from 'react'
import { PlatformOverlay, type PlatformBridge } from './onboarding/PlatformOverlay.tsx'
import { createPlatformPages } from './onboarding/platform-pages.ts'
import { language } from './locale.ts'
import type { TranscriptViewMode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ClientContext } from './native.ts'
import type { AccountController } from './account-controller.ts'
import {mountBeginnerTour} from './onboarding/BeginnerTour.tsx'

/** Keep the original introduction without sharing account credentials.
 * @param ctx - Native client services and slot registration.
 * @param account - iPolloWork account state owner.
 */
export function mountDesktopOnboarding(ctx: ClientContext, account: AccountController): void {
  const tutorial=mountBeginnerTour(ctx)
  let tutorialTimer:ReturnType<typeof setTimeout>|undefined
  ctx.effect(()=>()=>clearTimeout(tutorialTimer),'ipollowork-suite: tutorial handoff')
  const platform = (globalThis as typeof globalThis & { dshPlatform?: PlatformBridge }).dshPlatform
  const pages = createPlatformPages()
  ctx.effect(() => () => pages.dispose(), 'ipollowork-suite: top-up page lifetime')
  if (platform) ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'ipollowork-top-up',
  }, function TopUpPage() {
    const claim = useSyncExternalStore(pages.subscribe, pages.getSnapshot)
    if (!claim) return null
    const zh = language(ctx) === 'zh'
    return createElement(PlatformOverlay, {
      bridge: platform, page: claim.page, onClose: pages.close,
      backLabel: zh ? '返回 iPolloWork' : 'Back to iPolloWork',
      loadingLabel: zh ? '正在加载…' : 'Loading…',
      failureLabel: zh ? '无法加载充值页面' : 'Could not load the top-up page',
      retryLabel: zh ? '重试' : 'Try again',
    })
  }))
  const listeners = new Set<() => void>()
  const read = (): AccountSnapshot => {
    const state = account.getSnapshot()
    const signedIn = state.account?.status === 'signed-in'
    return {
      view: state.account === null ? undefined : {
        status: signedIn ? 'credential-stored' : 'signed-out',
      },
      failed: state.error !== null,
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
    ctx.configForms.get<OnboardingSettings>('ipollowork-onboarding'),
    ctx.configForms.get<{ transcriptView?: TranscriptViewMode | null; performanceUsage: 'compact' | 'detailed' }>('ui-chat'),
    enabled => ctx.configForms.developerTools.setEnabled(enabled),
    source, readOnboardingApiKeyPresence, ctx.configForms.describe(),
  )
  ctx.effect(() => {
    const refresh = () => controller.invalidateCredentials()
    const dispose = [ctx.remote.$on('credentials/reference-updated', refresh), ctx.remote.$on('llm/adapters-updated', refresh)]
    return () => { for (const release of dispose) release() }
  }, 'ipollowork-suite: onboarding credential state')
  ctx.effect(() => () => { controller.dispose(); unsubscribe(); listeners.clear() }, 'ipollowork-suite: desktop introduction')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'ipollowork-desktop-onboarding',
    inject: () => ({
      hooks: { account: source, onboarding: controller.state },
      t: (key: AccountKey) => key === 'close' ? language(ctx) === 'zh' ? '关闭' : 'Close' : (language(ctx) === 'zh' ? onboardingZh : onboardingEn)[key],
      setVisible: () => {},
      ...(platform ? { openPlatformPage: (page, closed) => pages.open(page, () => { closed(); void account.refresh() }) } : {}),
      update: change => controller.update(change),
      complete: async reason => {
        const accepted=await controller.complete(reason)
        if(accepted&&reason==='completed')tutorialTimer=setTimeout(()=>{void tutorial.start()},200)
        return accepted
      },
      retry: () => controller.retry(),
    } satisfies DesktopOnboardingInjected),
  }, DesktopOnboardingEntry))
}
