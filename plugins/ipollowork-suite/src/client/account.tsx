/** Account state has one owner shared by the native settings page and launcher. */
import { useEffect, useState, type FormEvent } from 'react'
import type { AccountState } from '../shared/types.ts'
import type { Labels } from './locale.ts'
import type { LauncherProps } from './native.ts'
import { IconEyeOffOutlineRegular, IconEyeOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { request } from './api.ts'
import { AccountArt, ArrowGlyph, CoinGlyph, LockGlyph, MailGlyph, Monogram } from './glyphs.tsx'
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
  const [registering, setRegistering] = useState(false); const [reveal, setReveal] = useState(false)
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (account?.status === 'signed-in') setRegistering(false) }, [account?.status])
  const host = (() => { try { return new URL(origin).host } catch { return origin } })()
  const submit = (event: FormEvent) => {
    event.preventDefault(); const secret = password; setPassword('')
    // The account service requires a display name; the email's local part is the editable default.
    if (registering) void signUp(email.split('@')[0] || email, email, secret)
    else void signIn(email, secret)
  }
  const message = error && (error === 'IPW_REGISTRATION_REJECTED' ? t.registrationError : error === 'IPW_SIGN_IN_REQUIRED' || error === 'IPW_INVALID_LOGIN' ? t.loginError : error === 'IPW_LOGIN_CANCELLED' ? t.canceled : t.error)
  const service = <p className={css.authService}><span data-state={error === 'IPW_SERVICE_UNAVAILABLE' ? 'down' : 'up'}/>{t.service} · <a href={origin} target="_blank" rel="noreferrer">{host}</a></p>
  if (account?.status === 'signed-in') {
    const name = account.user.name || account.user.email
    return <section className={css.authPage}>
      <div className={css.glassCard}>
        <div className={css.identity}>
          <Monogram id={account.user.email} label={name} size={44} round/>
          <div className={css.identityText}><strong>{name}</strong><small>{account.user.email}</small></div>
        </div>
        <div className={css.statRow}>
          <div><small><CoinGlyph size={12}/>{t.points}</small><strong>{account.points === null ? '—' : account.points.toLocaleString()}</strong></div>
          <div><small><IconSparkleRegular size={12}/>{t.accountStatus}</small><strong>{t.connected}</strong></div>
        </div>
        <div className={css.authFooter}>{service}<span className={css.spacer}/>
          <button type="button" className={css.quietButton} onClick={() => void refresh()} disabled={busy}>{t.refresh}</button>
          <button type="button" className={css.quietButton} onClick={() => void signOut()} disabled={busy}>{t.signOut}</button>
        </div>
      </div>
    </section>
  }
  return <section className={css.authPage}>
    <div className={css.glassCard}>
      <div className={css.authColumn}>
        <AccountArt/>
        <h1>{registering ? t.createTitle : t.welcomeTitle}</h1>
        <p className={css.authLead}>{t.accountIntro}</p>
        <div className={css.authSwitch} role="group" aria-label={t.account}>
          <button type="button" aria-pressed={!registering} onClick={() => { setRegistering(false); setPassword('') }} disabled={busy}>{t.signIn}</button>
          <button type="button" aria-pressed={registering} onClick={() => { setRegistering(true); setPassword('') }} disabled={busy}>{t.registerAccount}</button>
        </div>
        <form className={css.authForm} onSubmit={submit}>
          <label className={css.fieldPill}><MailGlyph size={15}/><span className={css.srOnly}>{t.email}</span>
            <input type="email" placeholder={t.email} value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required disabled={busy}/></label>
          <label className={css.fieldPill}><LockGlyph size={15}/><span className={css.srOnly}>{t.password}</span>
            <input type={reveal ? 'text' : 'password'} placeholder={registering ? t.passwordHint : t.password} value={password} onChange={event => setPassword(event.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 10 : undefined} maxLength={1024} required disabled={busy}/>
            <button type="button" className={css.fieldAction} aria-label={reveal ? t.hidePassword : t.showPassword} aria-pressed={reveal} onClick={() => setReveal(value => !value)}>
              {reveal ? <IconEyeOffOutlineRegular size={15}/> : <IconEyeOutlineRegular size={15}/>}</button></label>
          {message && <p role="alert" className={css.authError}>{message}</p>}
          <button className={css.authSubmit} type="submit" disabled={busy || !email || !password}>{busy ? t.loading : registering ? t.registerAndSignIn : t.signIn}<ArrowGlyph size={14}/></button>
        </form>
        {service}
      </div>
    </div>
  </section>
}
export function AccountLauncher({ wide, openSettings, useAccount, useLabels, bindSettings }: LauncherProps & Pick<AccountProps, 'useAccount' | 'useLabels'> & { bindSettings(open: (section?: string) => void): () => void }) {
  const t = useLabels(value => value); const { account } = useAccount(value => value)
  useEffect(() => bindSettings(openSettings), [bindSettings, openSettings])
  return <button className={css.launcher} onClick={() => openSettings('ipollowork-account')} title={t.account} aria-label={t.account}>
    {account?.status === 'signed-in' ? <Monogram id={account.user.email} label={account.user.name || account.user.email} size={26} round/> : <span className={css.avatar} aria-hidden="true">iP</span>}
    {wide && <span>{account?.status === 'signed-in' ? account.user.name || account.user.email : t.account}</span>}
  </button>
}
