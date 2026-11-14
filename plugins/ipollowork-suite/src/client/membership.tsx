/** Native account membership, metered allowance and external checkout. */
import { useEffect, useRef, useState } from 'react'
import type { AccountState } from '../shared/types.ts'
import type { MembershipState } from '../shared/membership.ts'
import type { Labels } from './locale.ts'
import { request } from './api.ts'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import './membership.css'

/** Keep purchase and usage in the existing account page; secrets stay in the Host.
 * @param props Signed-in account, localized copy and shared account refresh.
 * @returns Current membership, day/week usage and an expandable plan list.
 */
export function MembershipPanel({ account, t, refreshAccount, signOut }: { account: Extract<AccountState, { status: 'signed-in' }>; t: Labels; refreshAccount(): Promise<void>; signOut(): Promise<void> }) {
  const [data, setData] = useState<MembershipState>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [showPlans, setShowPlans] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [checkout, setCheckout] = useState<NonNullable<MembershipState['pendingOrder']>>()
  const [provider, setProvider] = useState<'stripe' | 'alipay' | 'wechat'>('stripe')
  const requests = useRef(new Map<string, string>())
  const submitting = useRef(false)
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    submitting.current = false
    setBusy(undefined)
    setError(undefined)
    void request<MembershipState>('/membership', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setData(value); setCheckout(value.pendingOrder ?? undefined); setProvider(value.channels.find(channel => channel.configured)?.id ?? 'stripe') }
    }).catch(() => { if (!controller.signal.aborted) setError(t.error) })
    const focused = () => { void refreshAccount() }
    window.addEventListener('focus', focused)
    return () => { controller.abort(); window.removeEventListener('focus', focused) }
  }, [account, refreshAccount, t.error])
  const number = (value: number) => value.toLocaleString(t.locale)
  const date = (value: number) => new Intl.DateTimeFormat(t.locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
  const purchase = async (planId: string, provider: 'stripe' | 'alipay' | 'wechat' | 'points') => {
    if (submitting.current) return
    submitting.current = true; setBusy(planId); setError(undefined); setNotice(undefined); setCheckout(undefined)
    const key = `${planId}/${provider}`
    if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID())
    const signal = lifetime.current?.signal
    try {
      const value = await request<{ orderId: string; paid?: boolean; url?: string; qrCode?: string }>('/membership/checkout', { method: 'POST', ...(signal ? { signal } : {}), body: JSON.stringify({ planId, provider, requestId: requests.current.get(key) }) })
      if (signal?.aborted) return
      if (value.url || value.qrCode) setCheckout(value)
      if (value.paid) { setNotice(t.membershipActivated); await refreshAccount() }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error && cause.message === 'INSUFFICIENT_POINTS' ? t.insufficientPoints : cause instanceof Error && cause.message === 'PAYMENT_NOT_CONFIGURED' ? t.paymentUnavailable : t.error)
    } finally { if (!signal?.aborted) { submitting.current = false; setBusy(undefined) } }
  }
  const syncPayment = async () => {
    if (!checkout || submitting.current) return
    const signal = lifetime.current?.signal
    submitting.current = true; setBusy(checkout.orderId)
    try {
      const value = await request<{ paid: boolean }>(`/membership/orders/${checkout.orderId}/sync`, { method: 'POST', body: '{}', ...(signal ? { signal } : {}) })
      if (signal?.aborted) return
      setNotice(value.paid ? t.membershipActivated : t.paymentPending); await refreshAccount()
    } catch { if (!signal?.aborted) setError(t.error) }
    finally { if (!signal?.aborted) { submitting.current = false; setBusy(undefined) } }
  }
  const balance = data?.points.balance ?? account.points
  const member = data?.memberships[0]
  const peak = Math.max(1, ...(data?.history.map(day => day.used) ?? []))
  return <div className="consumer-account" data-authenticated="true" data-embedded="true">
    <section className="consumer-card" aria-label={t.membership}>
      <header className="consumer-identity"><span className="consumer-avatar" aria-hidden="true">{(account.user.name || account.user.email).slice(0, 1).toUpperCase()}</span><div><strong>{account.user.name || account.user.email}</strong><span>{account.user.email}</span></div><span className={`consumer-plan-badge ${member ? 'is-pro' : ''}`}>{member?.name ?? t.noMembership}</span></header>
      <div className="consumer-points"><span>{t.points}</span><strong>{balance === null ? '—' : number(balance)}<small>{t.pointsUnit}</small></strong><p>{t.accountIntro}</p></div>
      <dl className="consumer-entitlements"><div><dt>{t.membership}</dt><dd>{member?.name ?? (data ? t.noMembership : t.loading)}</dd></div>{member && <div><dt>{t.membershipUntil}</dt><dd>{date(member.expiresAt)}</dd></div>}</dl>
      <div className="consumer-primary-actions"><button type="button" className="consumer-button" data-primary="true" onClick={() => setShowPlans(true)} disabled={!data}>{member ? t.renewMembership : t.openMembership}</button></div>
      {error && <p className="consumer-note" role="alert">{error}</p>}{notice && <p className="consumer-note" role="status">{notice}</p>}
      <div className="consumer-primary-actions"><button type="button" className="consumer-button" onClick={() => void refreshAccount()}>{t.refresh}</button><button type="button" className="consumer-button" onClick={() => void signOut()}>{t.signOut}</button></div>
    </section>
    <section className="consumer-card consumer-usage-card" aria-label={t.usageAllowance}>
      <header className="consumer-section-heading"><h2>{t.usageAllowance}</h2></header>
      {data ? (['daily', 'weekly'] as const).map(kind => {
        const value = data.usage[kind], label = kind === 'daily' ? t.dailyUsage : t.weeklyUsage
        const percent = value.limit ? Math.min(100, Math.max(0, value.used / value.limit * 100)) : 0
        const minutes = Math.ceil((value.resetsAt - Date.now()) / 60000)
        return <section className="consumer-allowance" aria-label={label} key={kind}>
          <div className="consumer-allowance-heading"><h3>{label}</h3><strong>{value.limit === null ? t.noLimit : `${Math.round(percent)}${t.usedPercent}`}</strong></div>
          {value.limit !== null && <div className="consumer-allowance-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={value.limit} aria-valuenow={Math.min(value.used, value.limit)}><span style={{ width: `${percent}%` }}/></div>}
          <div className="consumer-allowance-meta"><span>{number(value.used)}{value.limit === null ? '' : ` / ${number(value.limit)}`} {t.pointsUnit}</span><span>{minutes > 0 && minutes < 60 ? `${minutes} ${t.minutesToReset}` : `${t.resetsAt} ${date(value.resetsAt)}`}</span></div>
          {value.reserved > 0 && <p className="consumer-note">{t.reservedUsage} {number(value.reserved)} {t.pointsUnit}</p>}
        </section>
      }) : <p className="consumer-note">{error ? t.unavailable : t.loading}</p>}
      {data && <figure className="consumer-weekly"><figcaption><span>{t.lastSevenDays}</span><small>{t.pointsUnit}</small></figcaption><ol aria-label={t.lastSevenDays}>{data.history.map(day => <li key={day.date} title={`${day.date}: ${number(day.used)}`}><strong>{day.used ? number(day.used) : ''}</strong><div><span style={{ height: day.used > 0 ? `${Math.max(4, day.used / peak * 100)}%` : '2px' }} className={day.used ? 'is-used' : ''}/></div><time dateTime={day.date}>{new Intl.DateTimeFormat(t.locale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(new Date(day.date + 'T00:00:00Z'))}</time></li>)}</ol></figure>}
      {data && <footer className="consumer-usage-total"><span>{t.weeklyUsage}</span><strong>{number(data.usage.weekly.used)} <small>{t.pointsUnit}</small></strong></footer>}
    </section>
    {showPlans && data && <Modal open title={t.membershipPlans} closeLabel={t.hidePlans} onClose={() => { if (!busy) setShowPlans(false) }} className="consumer-subscribe-dialog">
      <label className="consumer-note">{t.paymentMethod}<select value={provider} onChange={event => setProvider(event.target.value as 'stripe' | 'alipay' | 'wechat')}>{data.channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}{channel.configured ? '' : ` · ${t.paymentUnavailable}`}</option>)}</select></label><div className="consumer-plan-options">{!data.plans.length && <p className="consumer-note">{t.noMembershipPlans}</p>}{data.plans.map(plan => <section key={plan.id} className="consumer-plan-option"><h3>{plan.name}</h3><div className="consumer-price">{new Intl.NumberFormat(t.locale, { style: 'currency', currency: plan.currency }).format(plan.amount / 100)}<span>/ {plan.days} {t.planDays}</span></div><p className="consumer-note">{number(plan.points)} {t.pointsUnit}</p><p className="consumer-note">{t.dailyLimit} {plan.dailyPoints === null ? t.noLimit : number(plan.dailyPoints)} · {t.weeklyLimit} {plan.weeklyPoints === null ? t.noLimit : number(plan.weeklyPoints)}</p><button type="button" className="consumer-button" data-primary="true" disabled={!data.channels.find(channel => channel.id === provider)?.configured || !!busy} onClick={() => void purchase(plan.id, provider)}>{busy === plan.id ? t.loading : data.channels.find(channel => channel.id === provider)?.configured ? t.buyMembership : t.paymentUnavailable}</button>{plan.pointsCost !== null && <button type="button" className="consumer-button" disabled={!!busy || balance === null || balance < plan.pointsCost} onClick={() => void purchase(plan.id, 'points')}>{t.redeemMembership} · {number(plan.pointsCost)}</button>}</section>)}</div>
      {checkout && <div className="consumer-checkout">{checkout.url && <a href={checkout.url} target="_blank" rel="noopener noreferrer" className="consumer-button" data-primary="true">{t.goToPayment}</a>}{checkout.qrCode && <PaymentQr value={checkout.qrCode} label={t.paymentMethod} error={t.error}/>}<small className="consumer-note">{t.paymentReturn}</small><button type="button" className="consumer-button" disabled={!!busy} onClick={() => void syncPayment()}>{t.syncPayment}</button></div>}
      {error && <p className="consumer-note" role="alert">{error}</p>}
    </Modal>}
  </div>
}

function PaymentQr({ value, label, error }: { value: string; label: string; error: string }) {
  const [image, setImage] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => { let active = true; setImage(undefined); setFailed(false); void import('qrcode').then(qr => qr.toDataURL(value, { width: 216, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#253029', light: '#ffffff' } })).then(url => { if (active) setImage(url) }).catch(() => { if (active) setFailed(true) }); return () => { active = false } }, [value])
  if (failed) return <p role="alert">{error}</p>
  return image ? <img src={image} width={216} height={216} alt={label} className="consumer-payment-qr"/> : null
}
