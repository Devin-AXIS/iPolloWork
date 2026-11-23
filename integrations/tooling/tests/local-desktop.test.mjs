import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { localDesktopFingerprint } from '../../desktop/scripts/prepare-local-desktop.mjs'

test('bulk maintenance disables only generated HMR and normal launch restores it without changing profile entries', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ipollo-hmr-config-'))
  const file = join(temporary, 'patch.yml'), worker = fileURLToPath(new URL('../../desktop/scripts/watch-local-suite.mjs', import.meta.url))
  const existing = '# Keep user preferences\n- id: existing-plugin\n  config:\n    enabled: true\n'
  try {
    await writeFile(file, existing)
    execFileSync(process.execPath, [worker, 'configure', file, 'disabled'])
    const disabled = await readFile(file, 'utf8')
    assert(disabled.startsWith(existing)); assert.match(disabled, /- id: hmr\n  disabled: true/)
    execFileSync(process.execPath, [worker, 'configure', file, 'enabled'])
    const restored = await readFile(file, 'utf8')
    assert(restored.startsWith(existing)); assert.match(restored, /- id: hmr\n  disabled: false/)
    assert.equal((restored.match(/- id: hmr/g) ?? []).length, 1)
  } finally { await rm(temporary, {recursive:true,force:true}) }
})

test('local desktop cache follows source and composition, excluding generated files and signing material', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'ipollo-local-desktop-'))
  const put = async (name, content) => {
    await mkdir(dirname(join(repository, name)), { recursive: true })
    await writeFile(join(repository, name), content)
  }
  try {
    for (const name of ['package.json', 'integrations/runtime/upstream.json', 'integrations/tooling/account-service.mjs', 'integrations/tooling/desktop-composition.mjs', 'plugins/ipollowork-suite/package.json', 'plugins/ipollowork-suite/cordis.patch.yml', 'plugins/ipollowork-suite/deployment.json', 'integrations/desktop/package.json', 'integrations/desktop/src/client/WelcomePage.tsx', 'integrations/desktop-host/src/index.ts']) await put(name, '{}')
    const initial = await localDesktopFingerprint(repository)
    for (const name of ['lib/main.js', 'node_modules/package/index.js', '.desktop-build/cache.json', '.env.local', 'signing.key']) await put('integrations/desktop/' + name, 'ignored')
    assert.equal(await localDesktopFingerprint(repository), initial)
    await put('integrations/desktop/src/client/WelcomePage.tsx', 'current welcome, same package version')
    const shell = await localDesktopFingerprint(repository)
    assert.notEqual(shell, initial)
    await put('integrations/desktop-host/src/index.ts', 'current host')
    const host = await localDesktopFingerprint(repository)
    assert.notEqual(host, shell)
    await put('integrations/tooling/desktop-composition.mjs', 'changed account composition')
    assert.notEqual(await localDesktopFingerprint(repository), host)
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})
