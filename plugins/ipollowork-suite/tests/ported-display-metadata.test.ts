import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { readPluginMeta } from '@deepseek-ai/dsh-app-boot'

test('all migrated native bundles expose localized metadata and icons to the DSH loader', async () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const inventory = JSON.parse(await readFile(join(root, 'integrations/runtime/ported-plugins.json'), 'utf8')) as { plugins: { id: string; name: string }[] }
  for (const item of inventory.plugins) {
    if (['design-agent', 'video-agent'].includes(item.id)) continue
    const directory = join(root, 'plugins', item.id === 'labelu-data-annotation' ? 'data-annotation' : item.id)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { exports: Record<string, string>; files: string[] }
    assert.equal(manifest.exports['./package.json'], './package.json', item.id)
    assert(manifest.files.includes('locale'), item.id)
    const meta = readPluginMeta(item.name, pathToFileURL(join(directory, 'package.json')).href)
    assert(meta, item.id)
    assert.equal(meta.error, undefined, item.id)
    assert(meta.icon?.startsWith('data:image/svg+xml;base64,'), item.id)
    assert(meta.title && typeof meta.title === 'object' && meta.title.en && meta.title.zh, item.id)
  }
})
