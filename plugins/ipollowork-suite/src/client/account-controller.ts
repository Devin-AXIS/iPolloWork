/** Shared native account state, including refreshed backend balances. */
import type { AccountState } from '../shared/types.ts'
import { request } from './api.ts'

export interface AccountSnapshot { account: AccountState | null; busy: boolean; error: string | null }
/** Shared account reads and mutations; newer mutations supersede pending reads. */
export class AccountController {
  private snapshot: AccountSnapshot = { account: null, busy: false, error: null }
  private listeners = new Set<() => void>()
  private lifetime = new AbortController()
  private sequence = 0
  getSnapshot = (): AccountSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(value: AccountSnapshot): void {
    if (this.lifetime.signal.aborted) return
    this.snapshot = value; window.dispatchEvent(new Event('ipollo-account-changed')); for (const listener of this.listeners) listener()
  }
  private async run(path: string, body?: unknown): Promise<void> {
    const sequence = ++this.sequence
    this.publish({ ...this.snapshot, busy: true, error: null })
    try {
      const account = await request<AccountState>(path, {
        signal: this.lifetime.signal, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      })
      if (sequence === this.sequence) this.publish({ account, busy: false, error: null })
    } catch (error) {
      if (sequence === this.sequence) this.publish({ ...this.snapshot, busy: false, error: error instanceof Error ? error.message : 'IPW_SERVICE_UNAVAILABLE' })
    }
  }
  private refreshing: Promise<void> | undefined
  /** Coalesce balance reads without superseding a pending sign-in or sign-out. */
  refresh = (): Promise<void> => {
    if (this.refreshing) return this.refreshing
    if (this.snapshot.busy || this.lifetime.signal.aborted) return Promise.resolve()
    const pending = this.run('/account').finally(() => {
      if (this.refreshing === pending) this.refreshing = undefined
    })
    this.refreshing = pending
    return pending
  }
  signIn = (email: string, password: string): Promise<void> => this.run('/account/sign-in', { email, password })
  signUp = (name: string, email: string, password: string): Promise<void> => this.run('/account/sign-up', { name, email, password })
  signOut = (): Promise<void> => this.run('/account/sign-out', {})
  private settingsOpener: ((section?: string) => void) | null = null
  /** Keep the native Settings navigation callback received by the mounted launcher. */
  bindSettings = (open: (section?: string) => void): (() => void) => { this.settingsOpener = open; return () => { if (this.settingsOpener === open) this.settingsOpener = null } }
  /** Open the account settings section; false when no native launcher is mounted. */
  openAccountSettings = (): boolean => { if (!this.settingsOpener) return false; this.settingsOpener('ipollowork-account'); return true }
  dispose(): void { this.lifetime.abort(); this.listeners.clear() }
}
