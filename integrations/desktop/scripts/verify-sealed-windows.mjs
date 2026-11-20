/** Qualify an unchanged Windows package through its Electron ASAR filesystem. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

assert.equal(process.platform, 'win32')
assert.equal(process.env.GITHUB_ACTIONS, 'true')
const source = process.cwd()
const module = path => import(pathToFileURL(join(source, path)).href)
const require = createRequire(join(source, 'integrations/desktop/package.json'))
const { readDesktopBuildCommit } = await module('integrations/desktop/scripts/desktop-build-commit.mjs')
assert.deepEqual(readDesktopBuildCommit(source), { commit: process.env.EXPECTED_COMMIT, dirty: false })
const version = process.env.RELEASE_TAG.replace(/^v/, '')
const artifacts = join(source, 'integrations/desktop/.desktop-build/targets/win-x64/unsigned-artifacts')
const executable = join(artifacts, 'win-unpacked/iPollo.exe')
const resources = join(artifacts, 'win-unpacked/resources/runtime')
const archivePath = join(artifacts, 'win-unpacked/resources/app.asar')
const root = join(archivePath, 'dsh')
const { readAsar } = require('app-builder-lib/out/asar/asar.js')
const archive = await readAsar(archivePath)
const metadata = JSON.parse((await archive.readFile('package.json')).toString())
assert.equal(metadata.version, version)
assert.equal(metadata.dshBuildCommit, process.env.EXPECTED_COMMIT)
assert.equal(metadata.dshBuildDirty, false)
const descriptor = JSON.parse((await archive.readFile('dsh/desktop-runtime.json')).toString())
assert.equal(descriptor.platform, 'win32')
assert.equal(descriptor.arch, 'x64')
assert.equal(descriptor.release.version, JSON.parse(readFileSync('integrations/runtime/upstream.json', 'utf8')).npmVersion)
const { verifyRuntimeArchive } = await module('integrations/desktop/scripts/verify-runtime-archive.ts')
const { desktopNodeEnvironment } = await module('integrations/desktop/src/node-environment.ts')
await verifyRuntimeArchive(archivePath, descriptor)
const environment = desktopNodeEnvironment(executable, join(resources, 'bin'), { ...process.env, NODE_OPTIONS: '' })
for (let iteration = 1; iteration <= 2; iteration++) {
  const payload = await promisify(execFile)(executable, ['--expose-internals', join(source, 'integrations/desktop/tests/fixtures/runtime-payload-smoke.mjs'), root, resources],
    { env: environment, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
  process.stdout.write(payload.stdout)
  const host = await promisify(execFile)(executable, ['--expose-internals', '--experimental-transform-types', fileURLToPath(new URL('./check-sealed-desktop-host.mjs', import.meta.url)), source, root, resources],
    { env: environment, timeout: 600000, maxBuffer: 8 * 1024 * 1024 })
  process.stdout.write(host.stdout)
  console.log(JSON.stringify({ event: 'sealed-windows-runtime-passed', iteration, commit: metadata.dshBuildCommit }))
}
const { stageWebsiteInstaller } = await module('integrations/desktop/scripts/stage-website-installer.ts')
console.log(await stageWebsiteInstaller(artifacts, 'win-x64', version, true))
