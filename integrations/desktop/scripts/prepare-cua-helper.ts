/** Build the official Computer Use helper outside the pinned source tree. */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadDesktopPackageEnvironment } from './desktop-package-environment.mjs'
import { resolveMacOSNotarizationEnvironment, resolveMacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { notarizeMacOS } from './notarize-macos.mjs'
import { verifyMacOSStapledTicket } from './verify-macos-signature.mjs'
import { readCuaApplication, sealCuaApplication } from '../../../.upstream/dsh/scripts/cua-helper/payload.ts'

const root = resolve(import.meta.dirname, '../../..')
const output = join(root, 'integrations/desktop/.desktop-build/cua-helper')
const source = join(output, 'source')
const environment = loadDesktopPackageEnvironment('darwin')
const signing = resolveMacOSSigningEnvironment(environment)
mkdirSync(source, { recursive: true })
cpSync(join(root, '.upstream/dsh/packages/experimental/cua-macos/native'), source, { recursive: true,
  filter: path => !path.split('/').some(part => part === '.build' || part === 'bin') })
for (const arch of ['arm64', 'x64'] as const) {
  const directory = join(output, 'native/bin', `darwin-${arch}`)
  let application: string | undefined
  if (existsSync(join(directory, 'current.json'))) {
    application = readCuaApplication(directory).application
    try { verifyMacOSStapledTicket(application) }
    catch { application = undefined }
  }
  if (application === undefined) {
    execFileSync('/usr/bin/xcrun', ['python3', join(source, 'build_app.py'), '--arch', arch === 'x64' ? 'x86_64' : arch,
      '--scratch-path', join(output, `swift-${arch}`), '--output-directory', directory,
      '--identity', `Developer ID Application: ${signing.signingIdentity}`], { stdio: 'inherit' })
    application = readCuaApplication(directory).application
    await notarizeMacOS({ appPath: application, ...resolveMacOSNotarizationEnvironment(environment) })
    sealCuaApplication(directory, application)
  }
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', application], { stdio: 'pipe' })
  console.log(`Computer Use helper verified: ${arch}`)
}
