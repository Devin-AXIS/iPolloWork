import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { mountNativeBrandCopy } from '../src/client/native-brand-copy.ts'

test('native brand copy is scoped, keeps compatibility values, and restores existing text on unload', async () => {
  const versionText = '2.0 requires ^0.3. Current DSH: 0.2.'
  const dom = new JSDOM(`<main data-plugin-panel>
    <p id="version">${versionText}</p>
    <code>Restart DSH. The package moved.</code>
    <p>Model DeepSeek V4</p>
  </main>
  <aside>${versionText}</aside>
  <div role="dialog"><p>DeepSeek Harness 0.2 preview.</p><p>Community for DeepSeek Harness.</p></div>
  <div data-textpreview-body><p>Read failed: Enable the preview service on the computer running DeepSeek Harness.</p></div>`)
  const globals = Object.fromEntries(['document', 'Text', 'NodeFilter', 'MutationObserver'].map(key => [key, dom.window[key]]))
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, globals)
  const messages = {
    'settings.models': { welcomeBody: 'DeepSeek Harness 0.2 preview.\n\nCommunity for DeepSeek Harness.' },
    sidebarOffice: { unavailable: 'Enable the preview service on the computer running DeepSeek Harness.' },
    sidebarDocumentPreview: { 'error.unavailable': 'Read failed: {message}' },
    pluginManager: {
      versionsBlockedDetail: '{version} requires {peers}. Current DSH: {runtime}.',
      restartNotice: 'Restart DSH.{reason}',
      restartReasonPackageMoved: ' The package moved.',
    },
  }
  let dispose
  let refresh
  try {
    mountNativeBrandCopy({
      effect: setup => { dispose = setup() },
      locale: {
        getSnapshot: () => ({ active: 'en' }),
        bind: ns => key => messages[ns]?.[key] ?? key,
        subscribe: listener => { refresh = listener; return () => { refresh = undefined } },
      },
    })
    const { document } = dom.window
    assert.equal(document.querySelector('#version').textContent, '2.0 requires ^0.3. Current iPolloWork plugin runtime: 0.2.')
    assert.equal(document.querySelector('aside').textContent, versionText)
    assert.equal(document.querySelector('code').textContent, 'Restart DSH. The package moved.')
    assert.match(document.querySelector('[role="dialog"]').textContent, /Welcome to the iPolloWork preview/)
    assert.equal(document.querySelector('[data-textpreview-body]').textContent, 'Read failed: Enable the preview service on the computer running iPolloWork.')
    assert.match(document.querySelector('main').textContent, /Model DeepSeek V4/)
    const notice = document.createElement('p')
    notice.textContent = 'Restart DSH. The package moved.'
    document.querySelector('main').append(notice)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(notice.textContent, 'Restart iPolloWork. The package moved.')
    notice.firstChild.data = 'Restart DSH.'
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(notice.textContent, 'Restart iPolloWork.')
    refresh()
    assert.equal(notice.textContent, 'Restart iPolloWork.')
    dispose()
    dispose = undefined
    assert.equal(notice.textContent, 'Restart DSH.')
    assert.equal(document.querySelector('#version').textContent, versionText)
    assert.equal(refresh, undefined)
  } finally {
    dispose?.()
    Object.assign(globalThis, previous)
    dom.window.close()
  }
})
