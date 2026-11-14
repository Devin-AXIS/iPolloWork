/** Account state has one owner shared by the native settings page and launcher. */
import { useEffect, useState, type FormEvent } from 'react'
import type { AccountState } from '../shared/types.ts'
import type { Labels } from './locale.ts'
import type { LauncherProps } from './native.ts'
import { request } from './api.ts'
import css from './suite.module.css'

interface AccountSnapshot { account: AccountState | null; busy: boolean; error: string | null }
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
  refresh = (): Promise<void> => this.run('/account')
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
interface AccountProps {
  useLabels<T>(selector: (value: Labels) => T): T; useAccount<T>(selector: (value: AccountSnapshot) => T): T;
  signIn(email: string, password: string): Promise<void>; signUp(name: string, email: string, password: string): Promise<void>; signOut(): Promise<void>; refresh(): Promise<void>; origin: string;
}
export function AccountPanel({ useLabels, useAccount, signIn, signUp, signOut, refresh, origin }: AccountProps) {
  const t = useLabels(value => value); const { account, busy, error } = useAccount(value => value)
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [name, setName] = useState(''); const [registering, setRegistering] = useState(false)
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (account?.status === 'signed-in') setRegistering(false) }, [account?.status])
  const submit = (event: FormEvent) => {
    event.preventDefault(); const secret = password; setPassword('')
    if (registering) void signUp(name, email, secret)
    else void signIn(email, secret)
  }
  return <section className={css.page}>
    <div className={css.heading}><div><h1>{t.account}</h1><p>{t.accountIntro}</p></div><button className={css.secondary} onClick={() => void refresh()} disabled={busy}>{t.refresh}</button></div>
    <p className={css.service}>{t.service} · <a href={origin} target="_blank" rel="noreferrer">{origin}</a></p>
    {error && <p role="alert" className={css.error}>{error === 'IPW_REGISTRATION_REJECTED' ? t.registrationError : error === 'IPW_SIGN_IN_REQUIRED' || error === 'IPW_INVALID_LOGIN' ? t.loginError : error === 'IPW_LOGIN_CANCELLED' ? t.canceled : t.error}</p>}
    {account?.status === 'signed-in' ? <div className={css.account}>
      <h2>{account.user.name || account.user.email}</h2><p>{account.user.email}</p>
      <div className={css.balance}><span>{t.points}</span><strong>{account.points === null ? t.unavailable : account.points.toLocaleString()}</strong></div>
      <button className={css.secondary} onClick={() => void signOut()} disabled={busy}>{t.signOut}</button>
    </div> : <form className={css.form} onSubmit={submit}>
      {registering && <label>{t.accountName}<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={120} required disabled={busy} /></label>}
      <label>{t.email}<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required disabled={busy} /></label>
      <label>{t.password}<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 10 : undefined} maxLength={1024} required disabled={busy} />{registering && <span className={css.muted}>{t.passwordHint}</span>}</label>
      <button className={css.primary} type="submit" disabled={busy}>{busy ? t.loading : registering ? t.registerAndSignIn : t.signIn}</button>
      <button className={css.secondary} type="button" disabled={busy} onClick={() => { setRegistering(value => !value); setPassword('') }}>{registering ? t.backToSignIn : t.registerAccount}</button>
    </form>}
  </section>
}
export function AccountLauncher({ wide, openSettings, useAccount, useLabels, bindSettings }: LauncherProps & Pick<AccountProps, 'useAccount' | 'useLabels'> & { bindSettings(open: (section?: string) => void): () => void }) {
  const t = useLabels(value => value); const { account } = useAccount(value => value)
  useEffect(() => bindSettings(openSettings), [bindSettings, openSettings])
  return <button className={css.launcher} onClick={() => openSettings('ipollowork-account')} title={t.account} aria-label={t.account}>
    <span className={css.avatar} aria-hidden="true">iP</span>
    {wide && <span>{account?.status === 'signed-in' ? account.user.name || account.user.email : t.account}</span>}
  </button>
}
