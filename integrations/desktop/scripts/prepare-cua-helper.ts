/** Re-sign the source-verified official Computer Use helper without modifying the pinned source tree. */
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadDesktopPackageEnvironment } from './desktop-package-environment.mjs'
import { resolveMacOSNotarizationEnvironment, resolveMacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { notarizeMacOS } from './notarize-macos.mjs'
import { verifyMacOSStapledTicket } from './verify-macos-signature.mjs'
import { readCuaApplication, sealCuaApplication } from '../../../.upstream/dsh/scripts/cua-helper/payload.ts'
import { cuaHelperSourceDigest } from '../../../.upstream/dsh/scripts/cua-helper/build-inputs.ts'
import { withPublishedCuaHelper } from './published-cua-helper.ts'

const root = resolve(import.meta.dirname, '../../..')
const output = join(root, 'integrations/desktop/.desktop-build/cua-helper')
const environment = loadDesktopPackageEnvironment('darwin')
const signing = resolveMacOSSigningEnvironment(environment)
const locked = JSON.parse(readFileSync(join(root, 'integrations/runtime/package-lock.json'), 'utf8')).packages['node_modules/@deepseek-ai/dsh-cua-macos'] as { version: string; integrity: string }
const sdkVersion = JSON.parse(readFileSync(join(root, '.upstream/dsh/package.json'), 'utf8')).version as string
if (!locked || locked.version !== sdkVersion) throw new Error('Published CUA helper version differs from the pinned SDK')
await withPublishedCuaHelper(output, { ...locked, sourceDigest: cuaHelperSourceDigest(join(root, '.upstream/dsh')) }, async provider => {
  const source = join(provider, '..', 'signing-source')
  mkdirSync(source, { recursive: true })
  cpSync(join(root, '.upstream/dsh/packages/experimental/cua-macos/native'), source, { recursive: true,
    filter: path => !path.split('/').some(part => part === '.build' || part === 'bin') })
  for (const arch of ['arm64', 'x64'] as const) {
    const directory = join(output, 'native/bin', `darwin-${arch}`)
    const staged = join(provider, '..', `signed-${arch}`)
    const official = readCuaApplication(join(provider, 'native/bin', `darwin-${arch}`)).application
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', official], { stdio: 'pipe' })
    const publish = 'import runpy,sys;from pathlib import Path;runpy.run_path(sys.argv[1])["publish"](Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[4],Path(sys.argv[5]))'
    execFileSync('/usr/bin/xcrun', ['python3', '-c', publish, join(source, 'build_app.py'),
      join(official, 'Contents/MacOS/dsh-cua-native'), staged, `Developer ID Application: ${signing.signingIdentity}`,
      join(source, 'Info.plist')], { stdio: 'inherit' })
    let application = readCuaApplication(staged).application
    await notarizeMacOS({ appPath: application, ...resolveMacOSNotarizationEnvironment(environment) })
    sealCuaApplication(staged, application)
    application = readCuaApplication(staged).application
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', application], { stdio: 'pipe' })
    verifyMacOSStapledTicket(application)
    if (process.arch === arch) execFileSync('/usr/bin/xcrun', ['python3', join(source, 'tests/protocol_e2e.py'),
      '--helper', join(application, 'Contents/MacOS/dsh-cua-native')], { stdio: 'inherit', timeout: 120_000 })
    if (dirname(directory) !== join(output, 'native/bin')) throw new Error('Refusing unexpected CUA build-cache replacement')
    rmSync(directory, { recursive: true, force: true })
    cpSync(staged, directory, { recursive: true })
    console.log(`Computer Use helper verified: ${arch}`)
  }
})
