import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'

test('legacy dialogs have one named native heading, supported buttons and shared reversible portal styles', () => {
  const require = createRequire(import.meta.url), React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  const prior = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document
  try {
    const primitives = {
      Button: React.forwardRef(({ variant, ...props }, ref) => React.createElement('button', { ...props, ref, 'data-native-variant': variant })),
      Input: props => React.createElement('input', props), Toast: () => null,
      Modal: ({ open, title, className, children }) => open ? React.createElement('section', { role: 'dialog', 'aria-label': title, className }, React.createElement('h2', null, title), children) : null,
    }
    const output = buildSync({ entryPoints: [fileURLToPath(new URL('../src/ported/native-ui.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'text' }, tsconfigRaw: {}, write: false })
    const compiled = { exports: {} }
    const lucide = require(fileURLToPath(new URL('../node_modules/lucide-react/dist/cjs/lucide-react.js', import.meta.url)))
    new Function('require', 'module', 'exports', output.outputFiles[0].text)(id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : id === 'lucide-react' ? lucide : require(id), compiled, compiled.exports)
    const disposeA = compiled.exports.installFrameUi(), disposeB = compiled.exports.installFrameUi()
    assert.equal(document.querySelectorAll('[data-ipw-ported-overlay]').length, 1)
    const rules = document.querySelector('[data-ipw-ported-overlay]').sheet.cssRules
    assert.ok([...rules].some(rule => rule.selectorText?.includes('.ipw-ported-overlay[role="dialog"]') && rule.style.overflow === 'auto'))
    const ui = window.__ipolloPortedUi, el = React.createElement
    const markup = renderToStaticMarkup(el(ui.Dialog, { open: true, onOpenChange() {} }, el(ui.DialogContent, { closeLabel: '关闭' },
      el(ui.DialogHeader, null, el(ui.DialogTitle, null, '新建', el('span', null, '短片')), el(ui.DialogDescription, null, '每个项目独立保存。')),
      el('form', null, el(ui.Input, { required: true }), el(ui.DialogFooter, null, el(ui.Button, { variant: 'secondary', disabled: true }, '取消'), el(ui.Button, { type: 'submit' }, '确定'))))))
    assert.match(markup, /aria-label="新建短片"/)
    assert.equal((markup.match(/<h2/g) ?? []).length, 1)
    assert.match(markup, /data-native-variant="ghost"/)
    assert.match(markup, /data-native-variant="primary"/)
    assert.match(markup, /type="submit"/)
    assert.match(markup, /disabled=""/)
    const tabs = renderToStaticMarkup(el(ui.Tabs, {value:'a',onValueChange(){}}, el(ui.TabsTrigger,{value:'a'},'画布'),el(ui.TabsTrigger,{value:'b'},'剧本')))
    assert.equal((tabs.match(/data-native-variant="ghost"/g) ?? []).length,2)
    assert.match(tabs,/aria-selected="true"/)
    assert.match(tabs,/aria-selected="false"/)
    const link=renderToStaticMarkup(el(ui.Button,{variant:'ghost',render:el('a',{href:'/draft/new'})},'新建草稿'))
    assert.match(link,/<a[^>]*href="\/draft\/new"/)
    assert(!link.includes('<button'))
    disposeA(); assert.equal(document.querySelectorAll('[data-ipw-ported-overlay]').length, 1)
    disposeB(); assert.equal(document.querySelectorAll('[data-ipw-ported-overlay]').length, 0)
    assert.equal(window.__ipolloPortedUi, undefined)
  } finally { globalThis.window = prior.window; globalThis.document = prior.document; dom.window.close() }
})
