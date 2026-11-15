/** Product-owned share presentation over the official DSH share-management service. */
import type { ClientContext } from '../native.ts'
import { LiveshareShareAction } from './ShareAction.tsx'
import type { OwnerShares } from './owner-shares.ts'
import type { OwnerSharePreparation } from './owner-preparation.ts'
import { setManagedShareOpener } from './share-navigation.ts'
import { language } from '../locale.ts'
import { en, zh, type LiveshareKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** Replace the official header cell without changing the share service or Agent runtime.
 * @param ctx - The suite's mounted client services.
 * @param prepareOwner - Resolve the account-backed relay before opening its dialog.
 */
export function mountSharing(ctx: ClientContext, prepareOwner: (signal: AbortSignal) => Promise<OwnerSharePreparation>): void {
  setManagedShareOpener(id => ctx.uiWorkspace.openSession(id))
  ctx.effect(() => () => setManagedShareOpener(undefined))
  ctx.inject(['remote.liveshareShares'], scope => {
    const shares: OwnerShares = scope.remote.liveshareShares
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities', id: 'liveshare-share', priority: -100, order: -7,
      children: { 'ipollowork.share.audience': { kind: 'single', scope: 'session' } },
      inject: () => ({ shares, prepareOwner, t: (key: LiveshareKey) => (language(ctx) === 'zh' ? zh : en)[key] }),
    }, LiveshareShareAction))
  })
}
