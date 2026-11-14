/** Package directory and resource canonicalization through the active runtime carrier's filesystem. */

import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Return whether the process reads application modules from pkg's virtual filesystem.
 * @returns whether pkg owns the module filesystem.
 */
function isPackagedExecutable(): boolean {
  return (process as NodeJS.Process & { pkg?: unknown }).pkg !== undefined
}

/**
 * Resolve a directory through the active carrier's filesystem implementation.
 * @param path - directory path to canonicalize.
 * @returns the canonical directory path.
 */
export function realModuleDirectory(path: string): string {
  const physical = physicalModuleDirectory(path)
  return isPackagedExecutable() ? realpathSync(physical) : realpathSync.native(physical)
}

/**
 * Select a complete unpacked Electron package without canonicalizing ordinary package links.
 * @param path - Package directory as resolved from its importing package.
 * @returns Physical unpacked directory when available, otherwise the original path.
 */
export function physicalModuleDirectory(path: string): string {
  const archive = /^(.*\.asar)([/\\].+)$/u.exec(path)
  if (archive?.[1] && archive[2]) {
    const unpacked = `${archive[1]}.unpacked${archive[2]}`
    // Complete unpacked packages keep worker entrypoints and executable dependencies on disk.
    if (existsSync(join(unpacked, 'package.json')) && statSync(archive[1]).isFile()) {
      return realpathSync.native(unpacked)
    }
  }
  return path
}

/** Canonicalize a module resource, preserving physical file aliases.
 * SEA archive files are symlink-free and support stat and reads, while their containing directories support realpath.
 * @param path Existing module resource path.
 * @returns Canonical resource path under the active carrier's filesystem.
 * @throws When the resource or its directory cannot be inspected or resolved.
 */
export function realModuleFile(path: string): string {
  return !isPackagedExecutable() || lstatSync(path).isSymbolicLink()
    ? realpathSync(path)
    : join(realModuleDirectory(dirname(path)), basename(path))
}
