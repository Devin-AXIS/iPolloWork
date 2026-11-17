import type { ClientContext } from './native.ts'

/** Route the pinned DSH toolbar's install actions to the shared installer. The toolbar
 * exposes slots for additional menu items, but its two built-in install actions are fixed. */
export function mountAddPlugin(ctx: ClientContext, open: () => void): void {
  const translate = ctx.locale.bind('pluginManager')
  const addGroup = '[data-plugin-toolbar]:not([hidden]) [role="group"]'
  const intercept = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (!button || button.disabled) return
    const group = button.closest(addGroup)
    const primary = group !== null && group.getAttribute('aria-label') === translate('addPlugin')
      && button.getAttribute('aria-label') === translate('addPlugin')
    // The menu is portaled outside the toolbar. Match its native install row only
    // while the toolbar's add menu is expanded.
    const menuTrigger = button.matches('[role="menuitem"]') && button.closest('[role="menu"]')
      && Array.from(button.querySelectorAll('span')).some(span =>
        span.childElementCount === 0 && span.textContent === translate('installExisting'))
      ? document.querySelector<HTMLButtonElement>(`${addGroup} button[aria-haspopup="menu"][aria-expanded="true"]`)
      : null
    if (!primary && !menuTrigger) return
    event.preventDefault()
    event.stopPropagation()
    menuTrigger?.click()
    open()
  }
  ctx.effect(() => {
    document.addEventListener('click', intercept, true)
    return () => document.removeEventListener('click', intercept, true)
  }, 'ipollowork-suite: manual plugin installation')
}
