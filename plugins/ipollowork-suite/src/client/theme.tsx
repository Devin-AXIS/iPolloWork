/** Reversible iPolloWork identity: black and white surfaces with one blue accent, iPolloWork's mark and name in DSH's
 * brand places, and the page title. DSH retains its layout and light/dark preference. */
import type { ClientContext } from './native.ts'
import type { ReactNode } from 'react'
import css from './suite.module.css'
import './brand.css'
const pair = (light: string, dark: string) => ({ light, dark })
const MARK = '/ipollowork-suite/assets/mark.svg'
/** DSH's product titles across its build profile and baseline locales. */
const DSH_TITLE = /DeepSeek Harness|DSH Local Build|DSH 本地构建/g
export function mountTheme(ctx: ClientContext): void {
  ctx.effect(() => ctx.theme.overrideTokens('@ipollo/dsh-suite', {
    '--dsw-alias-bg-base': pair('#ffffff', '#161618'),
    '--dsw-alias-label-primary': pair('#18181b', '#ededef'),
    '--dsw-alias-label-secondary': pair('#71717a', '#a1a1aa'),
    '--dsw-alias-state-business-primary': pair('#2563eb', '#7aa2ff'),
    '--dsw-alias-link': pair('#2563eb', '#7aa2ff'),
    '--dsw-alias-button-info-fill': pair('#18181b', '#3f3f46'),
    '--dsw-alias-button-info-hover': pair('#3f3f46', '#52525b'),
    '--ipw-surface': pair('#ffffff', '#1e1e21'), '--ipw-muted-surface': pair('#f4f4f5', '#27272a'),
    '--ipw-text': pair('#18181b', '#ededef'), '--ipw-muted': pair('#71717a', '#a1a1aa'),
    '--ipw-border': pair('#ececef', '#2f2f33'), '--ipw-accent': pair('#2563eb', '#7aa2ff'),
    '--ipw-accent-ink': pair('#ffffff', '#0b1220'), '--ipw-wash': pair('#eff4ff', '#1b2333'),
    '--ipw-gradient-start': pair('#e4e4e7', '#34343a'), '--ipw-gradient-end': pair('#e4e4e7', '#34343a'),
    '--ipw-shadow': pair('0 1px 2px rgba(0,0,0,.03),0 6px 18px -10px rgba(0,0,0,.08)', '0 1px 2px rgba(0,0,0,.24)'),
    '--ipw-glow-blue': pair('rgba(96,165,250,.11)', 'rgba(96,165,250,.05)'),
    '--ipw-glow-gold': pair('transparent', 'transparent'),
  }), 'ipollowork-suite: palette')
  ctx.effect(() => { document.body.setAttribute('data-ipw-suite', ''); return () => document.body.removeAttribute('data-ipw-suite') }, 'ipollowork-suite: scope')
  ctx.effect(() => {
    const rename = () => {
      const title = document.title.replace(DSH_TITLE, 'iPolloWork')
      if (title !== document.title) document.title = title
    }
    rename()
    const observer = new MutationObserver(rename)
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, 'ipollowork-suite: page title')
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, BrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, BrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, HeroBrand))
  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({ name: 'conversation.hero.frame', id: 'ipollowork-ambient' }, AmbientFrame))
}
function AmbientFrame({ children, hero }: { children: ReactNode; hero: boolean }) {
  return <>{hero && <div className={css.ambient} aria-hidden="true"/>}{children}</>
}
function BrandMark({ size }: { size: number }) { return <img className={css.brandMark} width={size} height={size} src={MARK} alt=""/> }
function BrandName() { return <span className={css.brandName}>iPolloWork</span> }
/** The home headline: the mark and the product name replace DSH's whale and slogan, which brand.css hides. */
function HeroBrand({ size }: { size: number }) {
  return <span data-ipw-hero=""><img width={Math.round(size * .82)} height={Math.round(size * .82)} src={MARK} alt=""/><span>iPolloWork</span></span>
}
