import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('owned packages retain the original iPolloWork license while upstream notices remain separate', async () => {
  const license = await readFile('LICENSE', 'utf8')
  assert(license.startsWith('iPolloWork Source Available License\n'))
  for (const directory of ['plugins/ipollowork-suite', 'plugins/ipollo-enterprise', 'services/ipollowork', 'integrations/desktop', 'integrations/desktop-host', 'integrations/publisher', 'integrations/runtime']) {
    const manifest = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'))
    assert.equal(manifest.license, 'SEE LICENSE IN LICENSE', directory)
    assert.equal(await readFile(`${directory}/LICENSE`, 'utf8'), license, directory)
  }
  assert((await readFile('LICENSES/DSH-MIT.txt', 'utf8')).includes('Copyright (c) 2026 DeepSeek'))
  assert((await readFile('plugins/ipollowork-suite/vendor/dsh-im/LICENSE', 'utf8')).includes('Copyright (c) 2026 xmanrui'))
})
