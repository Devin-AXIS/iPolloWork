import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

test('every migrated sidebar entry has distinct meaningful artwork instead of a puzzle fallback', async () => {
  const inventory = JSON.parse(await readFile(new URL('../../../integrations/runtime/ported-plugins.json', import.meta.url), 'utf8')) as { plugins: { id: string; name: string; kind: string }[] }
  // Test the browser module's actual JS dependency, rather than tsx's declaration-only path alias.
  const require = createRequire(import.meta.url)
  const React = require('react') as typeof import('react')
  const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
  const output = buildSync({ entryPoints: [fileURLToPath(new URL('../src/ported/icons.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['lucide-react'], tsconfigRaw: {}, write: false })
  const compiled = { exports: {} }
  const lucide = require(fileURLToPath(new URL('../node_modules/lucide-react/dist/cjs/lucide-react.js', import.meta.url)))
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)((id: string) => id === 'lucide-react' ? lucide : require(id), compiled, compiled.exports)
  const { pluginGlyph } = compiled.exports as typeof import('../src/ported/icons.ts')
  const artwork = new Set<string>()
  for (const item of inventory.plugins.filter(item => item.kind !== 'existing-native')) {
    const Icon = pluginGlyph(item.id)
    assert(Icon, item.id)
    const svg = renderToStaticMarkup(React.createElement(Icon, { size: 16, strokeWidth: 1.6 }))
    assert(!svg.includes('lucide-puzzle'), item.id)
    assert(!artwork.has(svg), 'Duplicate sidebar glyph: ' + item.id)
    assert.equal(pluginGlyph(item.name), Icon)
    artwork.add(svg)
  }
  assert.equal(artwork.size, 20)
})
