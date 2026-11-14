/** Session-header action that opens the Liveshare owner-side share dialog. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconShareOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { LiveshareManageSharesDialog } from './ManageSharesDialog.tsx'
import { openManagedSession, rememberManagedShare, takeManagedShare } from './share-navigation.ts'
import { LiveshareShareDialog } from './ShareDialog.tsx'
import type { NS } from './locales.ts'
import type { OwnerShares } from './owner-shares.ts'
import type { OwnerSharePreparation } from './owner-preparation.ts'
import type {} from './share-audience.ts'
import css from './ShareAction.module.css'

/** Business face the header action receives: the owner's share-management Remote. */
export interface LiveshareShareActionInjected {
  /** Owner share management, addressed through the generated `liveshareShares` namespace. */
  readonly shares: OwnerShares
  /**
   * Prepare an application's sharing account before reading the native Relay state.
   * @param signal - Cancelled when this action unmounts.
   * @returns Preparation outcome, with localized recovery text on failure.
   */
  readonly prepareOwner?: (signal: AbortSignal) => Promise<OwnerSharePreparation>
}

/** Full props for the Liveshare Session-header utility. */
export type LiveshareShareActionProps =
  PropsRuntime<'conversation.session.header.utilities'> & InjectFace<LiveshareShareActionInjected> & PropsLocale<typeof NS> & Partial<PropsRenderSlots<'liveshare.share.audience'>>

/**
 * Render the Session Header Share action and its dialog for a local owner.
 * @param props - Session runtime plus localized copy.
 * @returns the header action and optional dialog.
 */
export function LiveshareShareAction({
  sessionId, useSessions, shares, prepareOwner, t, renderSlot,
}: LiveshareShareActionProps): ReactNode {
  const [view, setView] = useState<'closed' | 'share' | 'manage'>('closed')
  const [managedShare, setManagedShare] = useState<{ readonly sessionId: SessionId; readonly sessionTitle: string }>()
  const [defaultRelay, setDefaultRelay] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [preparationError, setPreparationError] = useState('')
  const preparation = useRef<AbortController>()
  const sessionTitle = useSessions(state => state.byId[sessionId]?.displayTitle) ?? sessionId

  useEffect(() => () => { preparation.current?.abort() }, [])

  const openShare = async (): Promise<void> => {
    if (preparation.current) return
    if (prepareOwner === undefined) { setView('share'); return }
    const attempt = new AbortController()
    preparation.current = attempt
    setPreparing(true)
    setPreparationError('')
    try {
      const result = await prepareOwner(attempt.signal)
      if (attempt.signal.aborted) return
      if (result.error !== undefined) { setPreparationError(result.error); return }
      if (!result.connected) { setView('share'); return }
      const relay = await shares.relay()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Cancellation can happen while the Relay request is pending.
      if (attempt.signal.aborted) return
      if (!relay.ok) { setPreparationError(t('dialog.hostUnavailable')); return }
      setDefaultRelay(relay.value.effective ?? '')
      setView('share')
    } catch (_error) {
      if (!attempt.signal.aborted) setPreparationError(t('dialog.identity.loginFailed'))
    } finally {
      preparation.current = undefined
      if (!attempt.signal.aborted) setPreparing(false)
    }
  }

  useEffect(() => {
    if (takeManagedShare(sessionId)) void openShare()
  }, [sessionId])

  useEffect(() => {
    if (view === 'closed' || defaultRelay !== '') return
    let cancelled = false
    void shares.relay()
      .then((result) => {
        if (cancelled || !result.ok) return
        // No saved address is a valid answer: the dialog opens with an empty field that says so.
        setDefaultRelay(result.value.effective ?? '')
      })
      .catch(() => { /* Dialog accepts a typed relay when the host read fails. */ })
    return () => { cancelled = true }
  }, [defaultRelay, view, shares])

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('header.action')}
        aria-busy={preparing}
        disabled={preparing}
        onClick={() => { setManagedShare(undefined); void openShare() }}
      >
        <span>{t('header.action')}</span>
        <IconShareOutlineRegular size={12} />
      </button>
      {preparationError === '' ? null : <Toast text={preparationError} onDone={() => { setPreparationError('') }} />}
      {view === 'share' && (
        <LiveshareShareDialog
          sessionId={managedShare?.sessionId ?? sessionId}
          sessionTitle={managedShare?.sessionTitle ?? sessionTitle}
          defaultRelay={defaultRelay}
          shares={shares}
          {...(renderSlot === undefined ? {} : { renderSlot })}
          onManage={() => { setView('manage') }}
          onClose={() => { setManagedShare(undefined); setView('closed') }}
          t={t}
        />
      )}
      {view === 'manage' && (
        <LiveshareManageSharesDialog
          shares={shares}
          onOpenShare={(target, title) => {
            const selected = { sessionId: target as SessionId, sessionTitle: title }
            if (target !== sessionId) {
              rememberManagedShare(target)
              openManagedSession(target)
            }
            setManagedShare(selected)
            setView('share')
          }}
          onClose={() => { setView('closed') }}
          t={t}
        />
      )}
    </>
  )
}
