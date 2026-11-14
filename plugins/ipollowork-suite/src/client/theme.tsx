/** Reversible palette and brand contributions. DSH retains its layout and light/dark preference. */
import type { ClientContext } from './native.ts'
import type { ReactNode } from 'react'
import css from './suite.module.css'
const pair = (light: string, dark: string) => ({ light, dark })
export function mountTheme(ctx: ClientContext): void {
  ctx.effect(() => ctx.theme.overrideTokens('@ipollo/dsh-suite', {
    '--dsw-alias-bg-base': pair('#ffffff', '#18191b'),
    '--dsw-alias-label-primary': pair('#202124', '#eeeeef'),
    '--dsw-alias-label-secondary': pair('#73777f', '#a8adb6'),
    '--dsw-alias-state-business-primary': pair('#6660da', '#a5a0ff'),
    '--ipw-surface': pair('#ffffff', '#242529'), '--ipw-muted-surface': pair('#f6f6f8', '#303136'),
    '--ipw-text': pair('#25262b', '#eeeeef'), '--ipw-muted': pair('#777b84', '#a8adb6'),
    '--ipw-border': pair('#eeeeF2', '#3b3d44'), '--ipw-accent': pair('#6660da', '#aaa4ff'),
    '--ipw-accent-ink': pair('#ffffff', '#191822'), '--ipw-wash': pair('#f2f0ff', '#302b44'),
    '--ipw-gradient-start': pair('#7fcdff', '#5e98cb'), '--ipw-gradient-end': pair('#ffe67d', '#c7ae53'),
    '--ipw-shadow': pair('0 8px 26px rgba(93,116,170,.09)', '0 8px 26px rgba(0,0,0,.2)'),
    '--ipw-glow-blue': pair('rgba(127,205,255,.14)', 'rgba(127,205,255,.05)'),
    '--ipw-glow-gold': pair('rgba(255,230,125,.12)', 'rgba(255,230,125,.04)'),
  }), 'ipollowork-suite: palette')
  ctx.effect(() => { document.body.setAttribute('data-ipw-suite', ''); return () => document.body.removeAttribute('data-ipw-suite') }, 'ipollowork-suite: scope')
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, BrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, BrandName))
  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({ name: 'conversation.hero.frame', id: 'ipollowork-ambient' }, AmbientFrame))
}
function AmbientFrame({ children, hero }: { children: ReactNode; hero: boolean }) {
  return <>{hero && <div className={css.ambient} aria-hidden="true"/>}{children}</>
}
function BrandMark({ size }: { size: number }) { return <img className={css.brandMark} width={size} height={size} src="/ipollowork-suite/assets/mark.svg" alt=""/> }
function BrandName() { return <span className={css.brandName}>iPolloWork</span> }
