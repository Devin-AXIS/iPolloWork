/** Credential values stay in a dedicated native dialog, outside the IM settings page. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)
test('IM key forms use the native modal and keep their existing submit fields', async () => {
  const result = await build({ entryPoints: ['vendor/dsh-im/plugin-src/client/credential-binding.js'], bundle: true, platform: 'node', format: 'cjs', external: ['react', '@deepseek-ai/dsh-client-ui-primitives'], write: false })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: name => name === '@deepseek-ai/dsh-client-ui-primitives' ? { Modal: ({ title, children }) => React.createElement('div', { role: 'dialog', 'aria-label': title }, children) } : require(name) })
  const html = renderToStaticMarkup(React.createElement(module.exports.CredentialBindingPanel, { channel: 'feishu', identityLabel: 'App ID', secretLabel: 'App secret' }))
  const document = new JSDOM(html).window.document
  assert.equal(document.querySelectorAll('[role="dialog"] input').length, 2)
  assert.equal(document.querySelectorAll('[role="dialog"] input[type="password"]').length, 1)
  assert.equal(document.querySelectorAll('body > input').length, 0)
})
