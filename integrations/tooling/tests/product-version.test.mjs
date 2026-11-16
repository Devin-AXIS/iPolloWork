import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

test('desktop product versions remain independent from the pinned runtime', async () => {
  const [product, desktop, pin] = await Promise.all([
    manifest('../../../package.json'),
    manifest('../../desktop/package.json'),
    manifest('../../runtime/upstream.json'),
  ])
  assert.equal(product.version, desktop.version)
  assert.match(product.version, /^\d+\.\d+\.\d+$/)
  assert.notEqual(product.version, pin.npmVersion)
})
