import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { mountPluginToggleLimit } from '../src/client/plugin-toggle-limit.ts'
import { createPluginToggleLimit } from '../src/host/plugin-toggle-limit.ts'

test('the Host refuses overlapping bundle and component toggles and releases admission after failure', async () => {
  const limit = createPluginToggleLimit()
  const bundle = '/api/pluginManager/setBundleEnabled'
  const component = '/api/pluginManager/setPluginEnabled'
  const refused = []
  const response = { writeHead: status => refused.push(status), end() {} }
  const run = (url, next) => limit({ method: 'POST', url }, response, next)
  const pending = Promise.withResolvers()
  const first = run(bundle, () => pending.promise)
  await run(bundle, () => assert.fail('duplicate bundle operation reached the manager'))
  await run(component + '?view=details', () => assert.fail('component operation reached the manager'))
  assert.deepEqual(refused, [409, 409])
  let read = false
  await run('/api/pluginManager/listBundles', async () => { read = true })
  assert(read)
  pending.reject(new Error('native operation failed'))
  await assert.rejects(first, /native operation failed/)
  let toggled = false
  await run(component, async () => { toggled = true })
  assert(toggled)
})

test('native switches share the active lock across renders and release it without a write', async () => {
  const markup = `<section data-plugin-panel>
    <div data-plugin-package="first"><span role="status"></span><button role="switch">First</button></div>
    <div data-plugin-package="second"><span role="status"></span><button role="switch">Second</button></div>
    <div data-plugin-detail="second">
      <div data-plugin-rows><div data-plugin-row><button role="switch">Part</button></div></div>
      <div data-plugin-config><button role="switch">Setting</button></div>
    </div>
  </section>`
  const dom = new JSDOM(markup)
  const { document, Element, MutationObserver } = dom.window
  const previous = { document: globalThis.document, Element: globalThis.Element, MutationObserver: globalThis.MutationObserver }
  Object.assign(globalThis, { document, Element, MutationObserver })
  const listeners = new Set()
  let busy = false
  let dispose
  try {
    mountPluginToggleLimit({ effect: setup => { dispose = setup() } }, {
      bundle: () => ({
        getSnapshot: () => busy,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      }),
    })
    const [first, second, part, setting] = document.querySelectorAll('button')
    let overlappingClicks = 0
    first.addEventListener('click', () => { busy = true })
    for (const button of [second, part]) {
      button.addEventListener('click', () => { overlappingClicks++ })
    }
    first.click()
    assert(busy)
    assert.equal(second.getAttribute('aria-disabled'), 'true')
    assert.equal(part.getAttribute('aria-disabled'), 'true')
    assert.equal(setting.getAttribute('aria-disabled'), null)
    second.click()
    part.click()
    assert.equal(overlappingClicks, 0)
    const replacement = second.cloneNode(true)
    replacement.removeAttribute('aria-disabled')
    replacement.removeAttribute('data-ipw-plugin-toggle-locked')
    second.replaceWith(replacement)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(replacement.getAttribute('aria-disabled'), 'true')
    busy = false
    for (const listener of listeners) listener()
    assert.equal(replacement.getAttribute('aria-disabled'), null)
    replacement.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(listeners.size, 0)
  } finally {
    dispose?.()
    Object.assign(globalThis, previous)
    dom.window.close()
  }
})
