// @vitest-environment jsdom
/**
 * The Session-header Share action: the button a local owner opens, the dialog it opens, and the live
 * relay address that dialog starts from.
 */

import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveshareShareAction } from '../src/client/ShareAction.tsx'
import { en, NS, zh } from '../src/client/locales.ts'
import type { OwnerShares } from '../src/client/owner-shares.ts'
import type { LiveshareShareActionInjected, LiveshareShareActionProps } from '../src/client/ShareAction.tsx'
import type { OwnerSharePreparation } from '../src/client/owner-preparation.ts'
import { accepted, ownerSharesDouble, refused } from './owner-shares-double.client.ts'
import { rememberManagedShare, setManagedShareOpener } from '../src/client/share-navigation.ts'

const SESSION = 'owner-session' as SessionId

// The action reads its copy through the locale seat the browser composition provides.
const locale = new LocaleRuntime(new Context())
locale.register(NS, { zh, en })
locale.setLocale('zh')
const t = locale.bind(NS)

afterEach(cleanup)

/** One Session list carrying the Session the action belongs to, or none at all. */
function list(displayTitle?: string): { byId: Record<string, unknown> } {
  return displayTitle === undefined ? { byId: {} } : { byId: { [SESSION]: { displayTitle } } }
}

/**
 * Render the header action over one scripted Remote namespace.
 * @param shares - Owner share management the action addresses.
 * @param rows - The Session list the action reads its title from.
 * @param prepareOwner - Optional application account connection.
 * @param renderSlot - Optional recipient selector.
 * @returns The rendered container.
 */
function renderAction(shares: OwnerShares, rows: { byId: Record<string, unknown> } = list('Review the migration'), prepareOwner?: LiveshareShareActionInjected['prepareOwner'], renderSlot?: LiveshareShareActionProps['renderSlot']) {
  const View = LiveshareShareAction as (props: Record<string, unknown>) => ReactNode
  return render(<View
    sessionId={SESSION} shares={shares} t={t} prepareOwner={prepareOwner} renderSlot={renderSlot}
    useSessions={(selector: (value: unknown) => unknown) => selector(rows)}
  />)
}

describe('Session header Share action', () => {
  it('retains application recipient selection after preparing the native account', async () => {
    const { shares } = ownerSharesDouble()
    renderAction(shares, list(), async () => ({ connected: true }), () => <div>组织范围</div>)
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    expect(await screen.findByText('组织范围')).toBeTruthy()
  })
  it('waits for the application connection before opening the native dialog and ignores duplicate clicks', async () => {
    let finish!: (value: OwnerSharePreparation) => void
    const pending = new Promise<OwnerSharePreparation>((resolve) => { finish = resolve })
    const prepare = vi.fn(() => pending)
    const { shares, calls } = ownerSharesDouble()
    renderAction(shares, list(), prepare)
    const button = screen.getByRole('button', { name: zh['header.action'] })
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(button).toHaveProperty('disabled', true)
    expect(calls).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: zh['dialog.title'] })).toBeNull()
    await act(async () => { finish({ connected: true }); await pending })
    expect(await screen.findByRole('heading', { name: zh['dialog.title'] })).toBeTruthy()
  })

  it('keeps a refused preparation out of the dialog and allows retry', async () => {
    const prepare = vi.fn().mockResolvedValueOnce({ error: '请先连接账号' }).mockResolvedValue({ connected: true })
    const { shares, calls } = ownerSharesDouble()
    renderAction(shares, list(), prepare)
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '请先连接账号')
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    expect(await screen.findByRole('heading', { name: zh['dialog.title'] })).toBeTruthy()
  })

  it('preserves manual native setup when no application handles preparation', async () => {
    const { shares } = ownerSharesDouble({ relay: async () => refused('liveshareShares/invalid-relay-url', {}) })
    renderAction(shares, list(), async () => ({}))
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    expect(await screen.findByRole('heading', { name: zh['dialog.title'] })).toBeTruthy()
  })

  it('reports failed preparation and failed native connection reads without opening a share', async () => {
    const prepare = vi.fn().mockRejectedValueOnce(Error('Unavailable')).mockResolvedValue({ connected: true })
    const { shares, calls } = ownerSharesDouble({ relay: async () => refused('liveshareShares/invalid-relay-url', {}) })
    renderAction(shares, list(), prepare)
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh['dialog.identity.loginFailed'])
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveProperty('textContent', zh['dialog.hostUnavailable']) })
    expect(calls.map(call => call.method)).toEqual(['relay'])
  })

  it('aborts preparation when the header leaves without reading or publishing a share', async () => {
    let signal: AbortSignal | undefined
    let finish!: (value: OwnerSharePreparation) => void
    const pending = new Promise<OwnerSharePreparation>((resolve) => { finish = resolve })
    const { shares, calls } = ownerSharesDouble()
    const view = renderAction(shares, list(), (current) => { signal = current; return pending })
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { finish({}); await pending })
    expect(calls).toHaveLength(0)
  })

  it('does not open a dialog after an in-flight native read outlives its header', async () => {
    let finish!: (value: Awaited<ReturnType<OwnerShares['relay']>>) => void
    const pending = new Promise<Awaited<ReturnType<OwnerShares['relay']>>>((resolve) => { finish = resolve })
    const { shares, calls } = ownerSharesDouble({ relay: () => pending })
    const view = renderAction(shares, list(), async () => ({ connected: true }))
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    await waitFor(() => { expect(calls).toHaveLength(1) })
    view.unmount()
    await act(async () => { finish(accepted({})); await pending })
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('silently settles a cancelled preparation rejection and dismisses failure feedback', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<never>((_resolve, fail) => { reject = fail })
    const { shares } = ownerSharesDouble()
    const view = renderAction(shares, list(), () => pending)
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    view.unmount()
    await act(async () => { reject(Error('Cancelled')); await pending.catch(() => {}) })
    expect(screen.queryByRole('alert')).toBeNull()
    vi.useFakeTimers()
    try {
      renderAction(shares, list(), async () => ({ error: '连接失败' }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['header.action'] })) })
      expect(screen.getByRole('alert')).toHaveProperty('textContent', '连接失败')
      await act(async () => { vi.runAllTimers() })
      expect(screen.queryByRole('alert')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('keeps native address setup available when an application reports ready before a saved address exists', async () => {
    const { shares } = ownerSharesDouble({ relay: async () => accepted({}) })
    renderAction(shares, list(), async () => ({ connected: true }))
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    expect(await screen.findByRole('heading', { name: zh['dialog.title'] })).toBeTruthy()
  })

  it('opens the share dialog and asks the Host for the relay address in force', async () => {
    const { shares, calls } = ownerSharesDouble()
    renderAction(shares)

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))

    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    // The dialog is told which Session it publishes, including a Session the list does not name.
    expect(calls.map(call => call.method)).toContain('relay')
  })

  it('returns to the share dialog when the manager opens this same Session', async () => {
    const { shares } = ownerSharesDouble({
      list: async () => accepted({ shares: [{
        shareId: 'share', sessionIds: [SESSION], sessionTitle: 'Review the migration',
        link: 'https://relay.test/?shareId=share', createdAt: '2026-09-05T00:00:00Z', online: true,
      }] as never }),
    })
    renderAction(shares)
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    fireEvent.click(screen.getByText(zh['dialog.manage']))
    const manage = await screen.findByRole('button', { name: zh['manage.open'] })
    fireEvent.click(manage)
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    expect(screen.queryByText(zh['manage.title'])).toBeNull()
  })

  it('asks workspace navigation to open another Session selected in the manager', async () => {
    const open = vi.fn()
    setManagedShareOpener(open)
    const { shares } = ownerSharesDouble({
      list: async () => accepted({ shares: [{
        shareId: 'other', sessionIds: ['other-session'], sessionTitle: 'Other session',
        link: 'https://relay.test/?shareId=other', createdAt: '2026-09-05T00:00:00Z', online: true,
      }] as never }),
    })
    renderAction(shares)
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    fireEvent.click(screen.getByText(zh['dialog.manage']))
    const manage = await screen.findByRole('button', { name: zh['manage.open'] })
    fireEvent.click(manage)
    expect(open).toHaveBeenCalledWith('other-session')
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    expect(screen.queryByText('Other session')).toBeNull()
  })

  it('opens the share dialog when the manager left a request for this Session', async () => {
    rememberManagedShare(SESSION)
    const { shares } = ownerSharesDouble()
    renderAction(shares)
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
  })

  it('opens the dialog for a Session the list has not published', async () => {
    const { shares } = ownerSharesDouble()
    renderAction(shares, list())

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))

    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
  })

  it('starts from an empty address when the Host has none saved', async () => {
    const { shares } = ownerSharesDouble({ relay: async () => accepted({}) })
    renderAction(shares)

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))

    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh['dialog.connectionSettings'] }))
    expect(screen.getByLabelText(zh['dialog.relay'])).toHaveProperty('value', '')
    expect(screen.getByText(zh['dialog.addressHint'])).toBeTruthy()
  })

  it('opens the dialog when its listed Session has no display title', async () => {
    const { shares } = ownerSharesDouble()
    renderAction(shares, { byId: { [SESSION]: {} } })

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))

    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
  })

  it('opens the dialog when the Host fails to report its relay address', async () => {
    const { shares } = ownerSharesDouble({ relay: async () => { throw new Error('relay unavailable') } })
    renderAction(shares)

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))

    // Typing the address is still possible: a failed read is not a reason to keep the dialog closed.
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    expect(screen.getByText(zh['dialog.create'])).toBeTruthy()
  })

  it('opens the dialog when the Host answers that it could not read the relay address', async () => {
    const { shares } = ownerSharesDouble({
      relay: async () => refused('liveshareShares/invalid-relay-url', {}),
    })
    renderAction(shares)

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))

    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    expect(screen.getByText(zh['dialog.create'])).toBeTruthy()
  })

  it('moves from the share dialog to share management, which closes back to the header', async () => {
    const { shares } = ownerSharesDouble()
    renderAction(shares)

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    fireEvent.click(screen.getByText(zh['dialog.manage']))

    // The management surface lists this host's shares; the dialog it replaced is gone.
    await waitFor(() => { expect(screen.getByText(zh['manage.title'])).toBeTruthy() })
    expect(screen.queryByRole('heading', { name: zh['dialog.title'] })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: zh['manage.done'] })[0] as HTMLElement)
    await waitFor(() => { expect(screen.queryByText(zh['manage.title'])).toBeNull() })
  })

  it('closes the share dialog without publishing anything', async () => {
    const { shares, calls } = ownerSharesDouble()
    renderAction(shares)

    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    await waitFor(() => { expect(screen.getByRole('heading', { name: zh['dialog.title'] })).toBeTruthy() })
    // A fresh dialog states no link yet, so its close control is the cancel affordance.
    fireEvent.click(screen.getAllByRole('button', { name: zh['dialog.cancel'] })[0] as HTMLElement)

    await waitFor(() => { expect(screen.queryByRole('heading', { name: zh['dialog.title'] })).toBeNull() })
    expect(calls.map(call => call.method)).not.toContain('create')
  })
})
