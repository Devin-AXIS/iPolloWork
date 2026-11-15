/** Verify physical Windows runtime executables without changing their signed bytes. */
import { lstat, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { windowsRuntimeCode } from './windows-runtime-signature.mjs'

/**
 * Collect executable files that the resource copy must preserve.
 * @param {import('app-builder-lib').BeforePackContext} _context Builder context.
 * @param {string} sourceRoot Prepared DSH directory.
 * @returns {Promise<string[]>} Executable paths relative to the prepared directory.
 */
export async function prepareWindowsAsarUnpack(_context, sourceRoot) {
  return (await windowsRuntimeCode(sourceRoot)).map(file => relative(sourceRoot, file))
}

/**
 * Reject missing, linked or changed executable files in the assembled application.
 * @param {string} sourceRoot Original signed DSH directory.
 * @param {string} resourcesDir Assembled resources directory.
 * @param {string[]} files Relative executable paths.
 * @returns {Promise<void>} Resolves when every executable retains its prepared bytes.
 */
export async function verifyWindowsAsarUnpack(sourceRoot, resourcesDir, files) {
  for (const file of files) {
    const copied = join(resourcesDir, 'dsh', file)
    const stat = await lstat(copied)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Windows runtime: expected a real executable: ${file}`)
    const [prepared, packaged] = await Promise.all([readFile(join(sourceRoot, file)), readFile(copied)])
    if (!prepared.equals(packaged)) throw new Error(`Windows runtime: executable bytes changed: ${file}`)
  }
}
