/** Stage product packages and verified native payloads for Desktop builds. */
import { stageCuaHelper } from './stage-cua-helper.ts'
import { stageWindowsCuaHelper } from './stage-windows-cua-helper.ts'

import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { x, c } from 'tar'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import {
  readClientBuildRecord,
} from '../../../scripts/client-build-environment.ts'
import { releaseFamily } from '../../../scripts/release/families.ts'
import { packFamilyMembers, parsePackConcurrency } from '../../../scripts/release/pack.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, concurrency: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.out === undefined) throw new Error('desktop local pack: --out must name the package staging directory')
  const concurrency = parsePackConcurrency(values.concurrency)
  const root = process.cwd()
  const upstream = resolve(root, '.upstream/dsh')
  readClientBuildRecord(upstream)
  const destination = resolve(root, values.out)
  const packed = await packFamilyMembers(upstream, releaseFamily('dsh'), destination, concurrency)
  if (process.platform === 'darwin') {
    const version = JSON.parse(readFileSync(resolve(upstream, 'packages/experimental/cua-macos/package.json'), 'utf8')).version
    await stageCuaHelper(resolve(destination, `deepseek-ai-dsh-cua-macos-${version}.tgz`), resolve(root, 'integrations/desktop/.desktop-build/cua-helper'))
  }
  if (process.platform === 'win32') {
    const version = JSON.parse(readFileSync(resolve(upstream, 'packages/experimental/cua-windows/package.json'), 'utf8')).version
    await stageWindowsCuaHelper(resolve(destination, `deepseek-ai-dsh-cua-windows-${version}.tgz`), root)
  }
  execFileSync(process.execPath, [resolve(root, 'integrations/tooling/desktop-composition.mjs')], { cwd: root, stdio: 'inherit' })
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', destination], { cwd: resolve(root, 'integrations/desktop-host'), stdio: 'inherit', shell: process.platform === 'win32' })
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: resolve(root, 'plugins/ipollowork-suite'), stdio: 'inherit', shell: process.platform === 'win32' })
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', destination], { cwd: resolve(root, 'plugins/ipollowork-suite'), stdio: 'inherit', shell: process.platform === 'win32' })
  for(const command of [['run','build'],['pack','--pack-destination',destination]])execFileSync(process.platform==='win32'?'npm.cmd':'npm',command,{cwd:resolve(root,'plugins/stage'),stdio:'inherit',shell:process.platform==='win32'});
  // Keep checked Studio archives available to the market without installing either plugin by default.
  const suiteName = JSON.parse(readFileSync(resolve(root, 'plugins/ipollowork-suite/package.json'), 'utf8'))
  const suiteArchive = resolve(destination, `ipollo-dsh-suite-${suiteName.version}.tgz`)
  const staging = mkdtempSync(join(tmpdir(), 'ipollo-desktop-suite-'))
  try {
    await x({ file: suiteArchive, cwd: staging })
    const manifestPath = join(staging, 'package/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const name of ['@ipollo/dsh-design-resources', '@ipollo/dsh-video-resources', 'deepseek-idesign', 'deepseek-ivideo']) {
      delete manifest.dependencies?.[name]
      delete manifest.optionalDependencies?.[name]
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await c({ gzip: true, file: suiteArchive, cwd: staging }, ['package'])
  } finally { rmSync(staging, { recursive: true, force: true }) }
  console.log(`desktop local pack: ${String(packed.length)} tarball(s) in ${destination}`)
}

await main()
