/** Compile and stage the pinned Windows helper without changing upstream source. */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c, x } from 'tar'

/**
 * Include the Windows x64 helper and its self-contained runtime in the provider archive.
 * @param archive Packed official Windows provider.
 * @param root Product repository directory.
 */
export async function stageWindowsCuaHelper(archive: string, root: string): Promise<void> {
  const cache = join(root, 'integrations/desktop/.desktop-build/cua-windows')
  const source = join(cache, 'source')
  const output = join(cache, 'native/bin/win-x64')
  mkdirSync(source, { recursive: true })
  cpSync(join(root, '.upstream/dsh/packages/experimental/cua-windows/native'), source, {
    recursive: true, filter: path => !path.split(/[\\/]/).some(part => ['bin', 'obj', '.build'].includes(part)),
  })
  execFileSync('dotnet', ['publish', join(source, 'entry/CuaWindows.csproj'), '--configuration', 'Release',
    '--runtime', 'win-x64', '--self-contained', 'true', '--output', output, '-p:EnableWindowsTargeting=true'], { stdio: 'inherit' })
  if (!existsSync(join(output, 'dsh-cua-windows.exe'))) throw new Error('Windows Computer Use helper was not produced')
  execFileSync(join(output, 'dsh-cua-windows.exe'), ['--help'], { stdio: 'pipe' })
  const temporary = mkdtempSync(join(tmpdir(), 'ipollo-windows-cua-'))
  try {
    await x({ file: archive, cwd: temporary })
    cpSync(output, join(temporary, 'package/native/bin/win-x64'), { recursive: true })
    await c({ file: archive, cwd: temporary, gzip: true }, ['package'])
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
