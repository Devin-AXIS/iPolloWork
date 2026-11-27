/** Detect the running Mac bundle rather than the folder where the update ZIP is cached. */
import { constants } from 'node:fs'
import { access, lstat } from 'node:fs/promises'
import { posix } from 'node:path'

export const macApplicationsDirectory = '/Applications'

export function macApplicationBundle(executable: string): string | undefined {
  const binaryDirectory = posix.dirname(executable)
  const contents = posix.dirname(binaryDirectory)
  const bundle = posix.dirname(contents)
  if (posix.isAbsolute(executable) && posix.basename(binaryDirectory) === 'MacOS'
    && posix.basename(contents) === 'Contents' && posix.extname(bundle) === '.app') return bundle
}

export function isMacReadOnlyUpdateError(message: string | undefined): boolean {
  return /\b(?:cannot update while running on|the application is on) a read[- ]only volume\b/iu.test(message ?? '')
    || /\bSQRLUpdaterErrorDomain\s+Code=8\b/u.test(message ?? '')
}

export async function macUpdateLocationIsReadOnly(bundle: string, check = access): Promise<boolean> {
  if (/\/T\/AppTranslocation\/[^/]+\/d\//u.test(bundle)) return true
  try { await check(bundle, constants.W_OK); return false }
  catch (error) { return errorCode(error) === 'EROFS' }
}

/**
 * Electron can enter its privileged replacement path before asking its conflict handler.
 * Use the native move only for an empty destination the current user can install into.
 */
export async function canMoveMacApplication(bundle: string, check = access, inspect = lstat): Promise<boolean> {
  try {
    await check(macApplicationsDirectory, constants.W_OK | constants.X_OK)
    try { await inspect(posix.join(macApplicationsDirectory, posix.basename(bundle))) }
    catch (error) { return errorCode(error) === 'ENOENT' }
    return false
  } catch {
    return false
  }
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}
