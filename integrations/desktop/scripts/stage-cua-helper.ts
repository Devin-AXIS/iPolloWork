/** Add the separately signed native helper to the unchanged official provider package. */
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { x, c } from 'tar'
import { readCuaApplication } from '../../../.upstream/dsh/scripts/cua-helper/payload.ts'

/**
 * Stage both notarized helper architectures; missing payloads fail before an installer is created.
 * @param archive Packed official macOS CUA provider.
 * @param payload Local signed helper cache.
 */
export async function stageCuaHelper(archive: string, payload: string): Promise<void> {
  for (const arch of ['arm64', 'x64']) {
    const directory = join(payload, 'native/bin', `darwin-${arch}`)
    if (!existsSync(join(directory, 'current.json'))) throw new Error(`Desktop CUA helper missing for ${arch}; build and notarize the native helper before packaging`)
    const { application: app } = readCuaApplication(directory)
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' })
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', app], { stdio: 'pipe' })
  }
  const temp = mkdtempSync(join(tmpdir(), 'ipollo-cua-pack-'))
  try {
    await x({ file: archive, cwd: temp })
    cpSync(join(payload, 'native/bin'), join(temp, 'package/native/bin'), { recursive: true })
    await c({ file: archive, cwd: temp, gzip: true }, ['package'])
  } finally { rmSync(temp, { recursive: true, force: true }) }
}
