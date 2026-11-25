import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ClientContext } from './native.ts'

const switches = [
  '[data-plugin-package] [role="status"] + button[role="switch"]',
  '[data-plugin-detail] > [data-window-drag] [role="status"] + button[role="switch"]',
  '[data-plugin-detail] [data-plugin-rows] [data-plugin-row] button[role="switch"]',
].map(selector => `[data-plugin-panel] ${selector}`).join(', ')
const marker = 'data-ipw-plugin-toggle-locked'

/** Native DSH exposes per-bundle activity but no way to set a shared disabled state on its switches. */
export function mountPluginToggleLimit(ctx: ClientContext, changes: Context['pluginChanges']): void {
  ctx.effect(() => {
    const marked = new Set<HTMLButtonElement>()
    let stopWatching: (() => void) | undefined
    let confirmWrite: ReturnType<typeof setTimeout> | undefined

    const markSwitches = () => {
      for (const button of marked) {
        if (!button.isConnected) restore(button)
      }
      for (const button of document.querySelectorAll<HTMLButtonElement>(switches)) {
        if (button.hasAttribute('aria-disabled')) continue
        button.setAttribute('aria-disabled', 'true')
        button.setAttribute(marker, '')
        marked.add(button)
      }
    }
    const observer = new MutationObserver(markSwitches)

    function restore(button: HTMLButtonElement) {
      button.removeAttribute(marker)
      button.removeAttribute('aria-disabled')
      marked.delete(button)
    }
    function unlock() {
      clearTimeout(confirmWrite)
      confirmWrite = undefined
      stopWatching?.()
      stopWatching = undefined
      observer.disconnect()
      for (const button of marked) restore(button)
    }

    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest<HTMLButtonElement>('button')
      if (!button?.matches(switches)) return
      if (stopWatching) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const owner = button.closest<HTMLElement>('[data-plugin-package], [data-plugin-detail]')
      const name = owner?.dataset.pluginPackage ?? owner?.dataset.pluginDetail
      if (button.disabled || !name) return

      const activity = changes.bundle(name)
      stopWatching = activity.subscribe(() => {
        if (confirmWrite === undefined && !activity.getSnapshot()) unlock()
      })
      markSwitches()
      observer.observe(document.body, { childList: true, subtree: true })
      // A trusted click can run microtasks between capture and React's handler.
      // Check after event dispatch so dialog-only actions release the lock.
      confirmWrite = setTimeout(() => {
        confirmWrite = undefined
        if (!activity.getSnapshot()) unlock()
      }, 0)
    }

    document.addEventListener('click', click, true)
    return () => {
      document.removeEventListener('click', click, true)
      unlock()
    }
  }, 'ipollowork-suite: plugin enablement limit')
}
