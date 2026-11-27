/** Synchronizes Windows caption symbols with the application document. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import { WINDOWS_CAPTION_BACKGROUND, WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'

/** Install the Windows-only titlebar marker and observe application language and palette changes. */
export function syncWindowsAppearance(): void {
  if (process.platform !== 'win32') return
  const mark = (): void => {
    const root = document.documentElement
    root.dataset.windowsTitlebar = ''
    root.style.setProperty('--dsh-windows-titlebar-height', `${WINDOWS_TITLEBAR_HEIGHT}px`)
  }
  // The root can be absent before the HTML parser creates it.
  if ((document.documentElement as HTMLElement | null) !== null) mark()
  const install = (): void => {
    mark()
    const root = document.documentElement
    const probe = document.createElement('span')
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;color-scheme:light dark;color:var(--dsw-alias-label-primary,CanvasText)'
    document.body.append(probe)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('Desktop caption requires a 2D canvas context')
    const systemPalette = window.matchMedia('(prefers-color-scheme: dark)')
    let previous = ''
    const send = (): void => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = getComputedStyle(probe).color
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      const symbolColor = `rgba(${red}, ${green}, ${blue}, ${Number(alpha) / 255})`
      const current = root.lang + symbolColor
      if (current === previous) return
      previous = current
      ipcRenderer.send(DESKTOP_IPC.windowsAppearance, root.lang, WINDOWS_CAPTION_BACKGROUND, symbolColor)
    }
    const observer = new MutationObserver(send)
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    document.head.addEventListener('load', send, true)
    systemPalette.addEventListener('change', send)
    window.addEventListener('pagehide', () => {
      observer.disconnect()
      probe.remove()
      document.head.removeEventListener('load', send, true)
      systemPalette.removeEventListener('change', send)
    }, { once: true })
    send()
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true })
  else install()
}
