import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { recordUpdateCleanupFailure } from '../src/update-cleanup-log.ts'
import { retireWindowsUpdateDuplicate, saveWindowsUpdateReceipt, windowsUpdaterCache } from '../src/updates/electron-updater/windows-cache.ts'

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'ipollo-update-cache-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, 'app-update.yml')
  const cache = join(root, 'ipollo-updater')
  const pending = join(cache, 'pending')
  const version = '1.0.17'
  const fileName = `iPollo-${version}-win-x64.exe`
  const installer = join(pending, fileName)
  const baseline = join(cache, 'installer.exe')
  const content = 'verified installer fixture'
  const sha512 = createHash('sha512').update(content).digest('base64')
  await mkdir(pending, { recursive: true })
  await writeFile(config, 'updaterCacheDirName: ipollo-updater\n')
  await writeFile(join(pending, 'update-info.json'), JSON.stringify({ fileName, sha512 }))
  await writeFile(installer, content)
  return { root, config, version, pending, installer, baseline, content }
}

test('only retires a verified duplicate after the same installer version starts', async t => {
  const f = await fixture(t)
  assert.equal(await windowsUpdaterCache(f.config, f.root), f.pending)
  await saveWindowsUpdateReceipt(f.pending, f.version, [f.installer])
  await writeFile(f.baseline, f.content)
  await retireWindowsUpdateDuplicate(f.pending, '1.0.16')
  assert.equal(await readFile(f.installer, 'utf8'), f.content)
  await retireWindowsUpdateDuplicate(f.pending, f.version)
  await assert.rejects(readFile(f.installer), { code: 'ENOENT' })
  assert.equal(await readFile(f.baseline, 'utf8'), f.content)
  await retireWindowsUpdateDuplicate(f.pending, f.version)
})

test('preserves the pending installer if the baseline is absent or different', async t => {
  const f = await fixture(t)
  await saveWindowsUpdateReceipt(f.pending, f.version, [f.installer])
  await retireWindowsUpdateDuplicate(f.pending, f.version)
  await writeFile(f.baseline, 'x'.repeat(f.content.length))
  await retireWindowsUpdateDuplicate(f.pending, f.version)
  assert.equal(await readFile(f.installer, 'utf8'), f.content)
})

test('rejects unsafe updater cache paths and ignores an unrelated installer handoff', async t => {
  const f = await fixture(t)
  await writeFile(f.config, 'updaterCacheDirName: ../other-app\n')
  assert.equal(await windowsUpdaterCache(f.config, f.root), undefined)
  await writeFile(f.baseline, f.content)
  await saveWindowsUpdateReceipt(f.pending, f.version, [f.baseline])
  await retireWindowsUpdateDuplicate(f.pending, f.version)
  assert.equal(await readFile(f.installer, 'utf8'), f.content)
})

test('rotates update cleanup diagnostics and retains one previous segment', async t => {
  const f = await fixture(t)
  const logs = join(f.root, 'logs')
  const current = join(logs, 'update-cleanup.jsonl')
  const previous = join(logs, 'update-cleanup.previous.jsonl')
  await mkdir(logs)
  await writeFile(previous, 'expired segment')
  await writeFile(current, 'x'.repeat(1024 * 1024))
  recordUpdateCleanupFailure(logs, { operation: 'remove', path: f.installer, error: new Error('fixture') })
  assert.equal(JSON.parse(await readFile(current, 'utf8')).event, 'update-cache-cleanup-failed')
  assert.equal((await readFile(previous)).length, 1024 * 1024)
})
