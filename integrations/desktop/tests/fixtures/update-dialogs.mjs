/** Real isolated update dialogs; installer handoff is recorded by the caller's inert updater. */
import { DesktopUpdateOverlays } from '../../lib/types/update-overlay.js'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeTheme, protocol } from 'electron'
import { DesktopUpdateDialog } from '../../lib/types/update-dialog.js'
import { DesktopBackgroundNotice } from '../../lib/types/background-notice.js'
import { desktopUpdateReadyConfirmation, resolveDesktopLocale } from '../../lib/types/locale.js'
import { pluginUpdatePrompt } from '../../lib/types/plugin-update.js'

async function rendered(window) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Dialog did not render')), 10000);
    function check() {
      if (!document.querySelector('main:not([hidden])') || Number(getComputedStyle(document.body).opacity) < 0.99) {
        requestAnimationFrame(check);
        return;
      }
      clearTimeout(deadline);
      resolve();
    }
    check();
  })`)
}

/** Exercise cancellation and explicit installation through the production preload and renderer. */
export async function qualifyUpdateDialogs(root, fixture) {
  const theme = nativeTheme.themeSource
  nativeTheme.themeSource = 'light'
  const locale = resolveDesktopLocale('zh-CN')
  const messages = locale.messages
  const screenshots = []
  protocol.handle('dsh-app', async request => {
    const name = new URL(request.url).pathname.slice(1)
    assert.ok(['design-platform.css', 'shell-theme.js', 'update-dialog.html', 'update-dialog.js', 'update-dialog.css', 'update-close.svg'].includes(name))
    const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css'
      : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html'
    return new Response(await readFile(new URL(`${name === 'design-platform.css' ? '../../lib/welcome' : '../../renderer'}/${name}`, import.meta.url)), { headers: { 'content-type': mime } })
  })
  const parent = new BrowserWindow({ show: true, width: 900, height: 650 })
  const dialogs = new DesktopUpdateDialog(fileURLToPath(new URL('../../lib/preload-update-dialog.cjs', import.meta.url)), locale, new DesktopUpdateOverlays())
  try {
    await parent.loadURL('data:text/html;charset=utf-8,<title>Update dialog qualification</title><h1>Local updater</h1>')
    const f = await fixture()
    const available = await f.coordinator.check()
    await f.coordinator.download(available.version)
    assert.equal(f.installations.length, 0)
    for (const active of [false, true]) {
      const ready = desktopUpdateReadyConfirmation(messages, available.version, process.platform)
      const options = {
        title: messages.updateTitle,
        message: active ? messages.updateActiveTasks : ready.message,
        detail: active ? messages.updateActiveTasksDetail : ready.detail,
        buttons: [active ? messages.updateStopTasks : messages.installAndRestart, messages.updateLater], cancelId: 1,
      }
      f.restart(async () => (await dialogs.show(parent, options)).response === 0)
      const created = once(app, 'web-contents-created', { signal: AbortSignal.timeout(10_000) })
      const pending = f.coordinator.install(available.version)
      const [, contents] = await created
      const window = { webContents: contents, isDestroyed: () => contents.isDestroyed() }
      await once(window.webContents, 'did-finish-load', { signal: AbortSignal.timeout(10_000) })
      await rendered(window)
      const view = await window.webContents.executeJavaScript(`({
        title: document.getElementById('title').textContent,
        detail: document.getElementById('detail').textContent,
        buttons: [...document.querySelectorAll('#actions button')].map(button => button.textContent),
        width: document.querySelector('main').getBoundingClientRect().width,
        radius: getComputedStyle(document.querySelector('main')).borderRadius,
        primary: getComputedStyle(document.querySelector('.primary')).backgroundColor,
        focused: document.activeElement.id, isolated: typeof window.require === 'undefined',
      })`)
      assert.deepEqual(view, { title: options.message, detail: options.detail, buttons: options.buttons,
        width: 420, radius: '20px', primary: 'rgb(15, 17, 21)', focused: 'dialog', isolated: true })
      assert.equal(await parent.webContents.executeJavaScript('getComputedStyle(document.body).filter'), 'none')
      assert.equal(f.installations.length, 0)
      assert.equal(f.coordinator.state.phase, 'ready')
      assert.equal(await window.webContents.executeJavaScript(`
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
        document.activeElement.id`), 'close')
      assert.equal(await window.webContents.executeJavaScript(`
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
        document.activeElement.textContent`), options.buttons.at(-1))
      await window.webContents.executeJavaScript("document.getElementById('dialog').focus()")
      const name = active ? 'update-active-tasks.png' : 'update-ready.png'
      await writeFile(join(root, name), (await window.webContents.capturePage()).toPNG())
      screenshots.push(name)
      const closed = once(window.webContents, 'destroyed', { signal: AbortSignal.timeout(10_000) })
      if (active) {
        await window.webContents.executeJavaScript("setTimeout(() => document.querySelector('.primary').click(), 0); undefined")
      } else {
        nativeTheme.themeSource = 'dark'
        parent.setContentSize(390, 420)
        const fits = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Narrow dark dialog did not render')), 5000);
          function check() {
            if (innerWidth !== 390 || !document.body.hasAttribute('data-ds-dark-theme')) { requestAnimationFrame(check); return; }
            clearTimeout(timeout);
            resolve([...document.querySelectorAll('#actions button')].every(button => {
              const bounds = button.getBoundingClientRect();
              return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
            }));
          }
          check();
        })`)
        assert.equal(fits, true)
        const narrow = 'update-ready-dark-narrow.png'
        await writeFile(join(root, narrow), (await window.webContents.capturePage()).toPNG())
        screenshots.push(narrow)
        await window.webContents.executeJavaScript("setTimeout(() => document.querySelector('.secondary').click(), 0); undefined")
      }
      const result = await pending
      await closed
      assert.equal(window.isDestroyed(), true)
      assert.equal(result.phase, active ? 'installing' : 'ready')
      assert.equal(f.installations.length, active ? 1 : 0)
      if (!active) {
        parent.setSize(900, 650)
        nativeTheme.themeSource = 'light'
      }
    }
    assert.deepEqual(f.installations, [[true, true]])
    const warning = pluginUpdatePrompt({ unknown: false, blocked: true, runtime: '0.2.3-alpha.2',
      issues: [{ name: 'local-plugin', version: '1.0.0', linked: true, enabled: true }] }, true)
    const createdWarning = once(app, 'web-contents-created', { signal: AbortSignal.timeout(10_000) })
    const acknowledged = dialogs.show(parent, { title: messages.updateTitle, message: warning.title, detail: warning.detail,
      buttons: [messages.updateAcknowledge], cancelId: 0 })
    const [, warningContents] = await createdWarning
    await once(warningContents, 'did-finish-load', { signal: AbortSignal.timeout(10_000) })
    await rendered({ webContents: warningContents })
    assert.equal(await warningContents.executeJavaScript("document.getElementById('detail').textContent"), warning.detail)
    assert.equal(await warningContents.executeJavaScript("document.querySelectorAll('#actions button').length"), 1)
    const warningClosed = once(warningContents, 'destroyed', { signal: AbortSignal.timeout(10_000) })
    warningContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    assert.equal((await acknowledged).response, 0)
    await warningClosed
    const created = once(app, 'web-contents-created', { signal: AbortSignal.timeout(10_000) })
    const diagnostics = 'exit 0; shutdown acknowledged false\n' + 'at internal/diagnostic/path\n'.repeat(1000)
    const pending = dialogs.show(parent, { title: messages.updateFailedTitle, message: messages.updateStopFailed,
      technicalDetails: diagnostics })
    const [, errorContents] = await created
    const errorWindow = { webContents: errorContents }
    await once(errorWindow.webContents, 'did-finish-load', { signal: AbortSignal.timeout(10_000) })
    await rendered(errorWindow)
    assert.equal(await errorWindow.webContents.executeJavaScript("document.getElementById('technical-details').open"), false)
    for (const expanded of [false, true]) {
      if (expanded) {
        assert.equal(await errorWindow.webContents.executeJavaScript("document.getElementById('technical-details-label').click(); document.getElementById('technical-details').open"), true)
        assert.equal(await errorWindow.webContents.executeJavaScript("document.getElementById('technical-details-content').textContent"), diagnostics)
        assert.equal(await errorWindow.webContents.executeJavaScript(`(() => {
          const detail = document.getElementById('technical-details-content');
          const button = document.querySelector('.primary').getBoundingClientRect();
          return detail.scrollHeight > detail.clientHeight && detail.getBoundingClientRect().height <= 180
            && button.top >= 0 && button.bottom <= innerHeight;
        })()`), true)
      }
      const name = expanded ? 'update-error-expanded.png' : 'update-error-collapsed.png'
      await writeFile(join(root, name), (await errorWindow.webContents.capturePage()).toPNG())
      screenshots.push(name)
    }
    assert.deepEqual(f.installations, [[true, true]])
    errorWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    assert.equal((await pending).response, 0)
    dialogs.cancel()
    await once(errorWindow.webContents, 'destroyed', { signal: AbortSignal.timeout(10_000) })
    const createdProgress = once(app, 'web-contents-created', { signal: AbortSignal.timeout(10_000) })
    const download = dialogs.show(parent, { title: messages.updateTitle, message: messages.updateDownloadInProgress,
      detail: messages.updateDownloadDetail, progress: { label: '正在下载 0%…', percent: 0 }, buttons: [messages.updateClose] })
    const [, progressContents] = await createdProgress
    await once(progressContents, 'did-finish-load', { signal: AbortSignal.timeout(10_000) })
    await rendered({ webContents: progressContents })
    const progressStatus = expression => progressContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Update progress did not render')), 5000);
      const check = () => {
        if (!(${expression})) { requestAnimationFrame(check); return; }
        clearTimeout(deadline);
        resolve(true);
      };
      check();
    })`)
    dialogs.setProgress({ label: '正在下载 36%…', percent: 36 })
    await progressStatus('document.getElementById("progress").value === 36')
    const progressName = 'update-progress-light.png'
    await writeFile(join(root, progressName), (await progressContents.capturePage()).toPNG())
    screenshots.push(progressName)
    dialogs.setProgress({ label: messages.updateVerifying })
    await progressStatus('!document.getElementById("progress").hasAttribute("value")')
    const progressClosed = once(progressContents, 'destroyed', { signal: AbortSignal.timeout(10_000) })
    dialogs.closeProgress()
    await download
    await progressClosed
    const markerPath = join(root, 'background-close-confirmed')
    const notice = new DesktopBackgroundNotice({ markerPath, locale: () => locale,
      show: options => dialogs.show(parent, options), focus: () => dialogs.focus() })
    try {
      for (const confirm of [false, true]) {
        parent.show()
        const createdNotice = once(app, 'web-contents-created', { signal: AbortSignal.timeout(10_000) })
        const hidden = Promise.withResolvers()
        notice.close(() => { parent.hide(); hidden.resolve() })
        const [, noticeContents] = await createdNotice
        const noticeWindow = { webContents: noticeContents }
        await once(noticeWindow.webContents, 'did-finish-load', { signal: AbortSignal.timeout(10_000) })
        await rendered(noticeWindow)
        assert.equal(parent.isVisible(), true)
        assert.deepEqual(await noticeWindow.webContents.executeJavaScript(`({
          message: document.getElementById('title').textContent,
          buttons: [...document.querySelectorAll('#actions button')].map(button => button.textContent),
          detailHidden: document.getElementById('detail').hidden,
        })`), JSON.parse(await readFile(new URL('../expected/background-close-confirmation.json', import.meta.url), 'utf8')))
        await assert.rejects(access(markerPath))
        const closedNotice = once(noticeWindow.webContents, 'destroyed', { signal: AbortSignal.timeout(10_000) })
        if (confirm) {
          const name = 'background-close-confirmation.png'
          await noticeWindow.webContents.executeJavaScript(`Promise.all(document.getAnimations().map(animation => animation.finished))`)
          await writeFile(join(root, name), (await noticeWindow.webContents.capturePage()).toPNG())
          screenshots.push(name)
          await noticeWindow.webContents.executeJavaScript("setTimeout(() => document.querySelector('.primary').click(), 0); undefined")
          await hidden.promise
        } else noticeWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        await closedNotice
        assert.equal(parent.isVisible(), !confirm)
      }
      await access(markerPath)
      parent.show()
      notice.close(() => { parent.hide() })
      assert.equal(parent.isVisible(), false)
      assert.equal(dialogs.isOpen, false)
    } finally { notice.dispose() }
    return screenshots
  } finally {
    dialogs.dispose()
    parent.destroy()
    protocol.unhandle('dsh-app')
    nativeTheme.themeSource = theme
  }
}
