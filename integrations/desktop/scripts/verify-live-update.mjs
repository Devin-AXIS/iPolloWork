/** Check a published feed using the real Electron updater, without downloading or installing. */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import updaterModule from 'electron-updater'
import { DesktopUpdateCoordinator } from '../lib/types/update-coordinator.js'
import { DesktopUpdateHttpExecutor } from '../lib/types/updates/electron-updater/http-executor.js'

async function main() {
let root, coordinator
try {
  await app.whenReady()
  root = await mkdtemp(join(tmpdir(), 'ipollo-live-update-'))
  const origin = process.env.IPOLLO_VERIFY_UPDATE_URL
  const currentVersion = process.env.IPOLLO_VERIFY_CURRENT_VERSION || '1.0.1'
  const expectedVersion = process.env.IPOLLO_VERIFY_TARGET_VERSION || '1.0.2'
  assert.ok(origin?.startsWith('https://'), 'An HTTPS release feed is required')
  const config = join(root, 'app-update.yml')
  await writeFile(config, 'updaterCacheDirName: ipollo-update-verification\n')
  const forbidden = () => { throw new Error('Installing or quitting the user application is forbidden in verification') }
  const adapter = { version: currentVersion, name: 'ipollo-update-verification', isPackaged: true,
    appUpdateConfigPath: config, userDataPath: root, baseCachePath: root,
    whenReady: async () => {}, quit: forbidden, relaunch: forbidden, onQuit: forbidden }
  const Target = process.platform === 'darwin' ? updaterModule.MacUpdater : updaterModule.NsisUpdater
  const updater = new Target(undefined, adapter)
  updater.logger = null
  updater.httpExecutor = new DesktopUpdateHttpExecutor(60000)
  updater.setFeedURL({ provider: 'generic', url: origin })
  updater.quitAndInstall = forbidden
  const states = []
  coordinator = new DesktopUpdateCoordinator(state => { states.push(state); return state }, async () => false,
    updater, () => true, () => currentVersion, undefined, 'stable')
  const result = await coordinator.check(true)
  assert.equal(result.phase, 'available', JSON.stringify(result))
  assert.equal(result.version, expectedVersion)
  assert.ok(states.some(state => state.phase === 'available'))
  const info = updater.updateInfoAndProvider?.info
  assert.ok(info?.files.length)
  for (const file of info.files) {
    const response = await fetch(new URL(file.url, origin), { method: 'HEAD', signal: AbortSignal.timeout(60000) })
    assert.equal(response.status, 200, file.url)
    assert.equal(Number(response.headers.get('content-length')), file.size, file.url)
  }
  console.log(JSON.stringify({ currentVersion, availableVersion: result.version, notificationState: result.phase,
    feed: origin, referencedFiles: info.files.map(file => file.url), downloaded: false, installed: false }))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  coordinator?.dispose()
  if (root) await rm(root, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
}
}
void main()
