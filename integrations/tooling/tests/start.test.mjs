import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('source launcher preserves existing profile and uses compiled official DSH', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ipw-start-test-'))
  const exec = promisify(execFile)
  try {
    const run = () => exec(process.execPath, ['integrations/tooling/start.mjs', '--profile', 'web', '--dump-config'], { env: { ...process.env, DSH_HOME: home }, maxBuffer: 4 * 1024 * 1024 })
    await run()
    const file = join(home, 'profiles/web/pnpm-workspace.yaml')
    const manifest = join(home, 'profiles/web/package.json')
    const value = JSON.parse(await readFile(manifest, 'utf8'))
    value.description = 'Preserve user profile'
    await writeFile(manifest, JSON.stringify(value))
    await run()
    assert.equal(JSON.parse(await readFile(manifest, 'utf8')).description, 'Preserve user profile')
    assert.match(await readFile(file, 'utf8'), /esbuild@0\.25\.12: true/)
    assert.match(await readFile(file, 'utf8'), /sharp@0\.34\.5: true/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
