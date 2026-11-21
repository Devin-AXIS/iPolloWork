import type { ClientContext } from './native.ts'
import css from './suite.module.css'
import { useCopy } from './locale.ts'
import './brand.css'
import { productTheme } from '../../../_shared/ui/theme.ts'
/** DSH's product titles across its build profile and baseline locales. */
const DSH_TITLE = /DeepSeek Harness|DSH Local Build|DSH 本地构建/g
export function mountTheme(ctx: ClientContext): void {
  ctx.effect(() => ctx.theme.overrideTokens('@ipollo/dsh-suite', productTheme), 'ipollowork-suite: palette')
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
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, heroBrand(ctx)))
}
function BrandMark({ size }: { size: number }) { return <span className={css.brandMark} style={{ width: size, height: size }} aria-hidden="true"/> }
function BrandName() { return <span className={css.brandName}>iPolloWork</span> }
/**
 * The home headline of the original iPolloWork home: the wordmark above the localized title. It replaces DSH's whale
 * and slogan, which brand.css hides.
 * @param ctx - supplies the active locale.
 * @returns the slot component.
 */
function heroBrand(ctx: ClientContext) {
  return function HeroBrand() {
    const { heroTitle } = useCopy(ctx)
    return <span data-ipw-hero=""><span data-ipw-wordmark="" role="img" aria-label="iPolloWork"/><span data-ipw-hero-title="">{heroTitle}</span></span>
  }
}
