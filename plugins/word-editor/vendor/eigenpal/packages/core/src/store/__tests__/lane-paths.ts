// Resolving a lane's files, loudly.
//
// The architectural guards in this directory scan lanes by path: `core/src/store`,
// `core/src/layout/semantic-layout.ts`, and so on. A guard that cannot find its files does
// not fail — `collectSources` on a missing directory returns an empty list, so the scan
// passes having scanned nothing.
//
// That is the real hazard: the collapse of the `engine-*` packages into `packages/core`
// turned several of these guards into vacuous passes rather than errors. So every scanned
// path is asserted to exist before it is scanned.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_LANES, type LaneName } from '../../__tests__/core-lane-graph.ts';

export const PACKAGES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Directory names that are themselves lanes inside `packages/core/src`.
 *
 * Scanning the contracts lane means scanning `core/src`, which CONTAINS every other lane as a
 * subdirectory — so a guard walking it would attribute the binding lane's ProseMirror imports
 * to the contracts lane. A collector skips these to stay inside one lane.
 */
export const NESTED_LANE_DIRECTORIES: ReadonlySet<string> = new Set(
  (Object.keys(CORE_LANES) as LaneName[])
    .filter((lane) => CORE_LANES[lane].directory.startsWith('src/'))
    .map((lane) => CORE_LANES[lane].directory.slice('src/'.length))
    .filter((name) => name.length > 0)
);

/** An absolute path to a `packages/`-relative file or directory. */
export function lanePath(path: string): string {
  return join(PACKAGES_ROOT, path.replaceAll('\\', '/'));
}

/**
 * Assert a scanned path exists before scanning it.
 *
 * The guards' failure mode is silence, not error: a lane that moves leaves them scanning
 * nothing and reporting success. This turns that into the failure it should have been.
 */
export function existingLanePath(path: string): string {
  const resolved = lanePath(path);
  if (!existsSync(resolved)) {
    throw new Error(
      `Lane path "${path}" resolves to "${resolved}", which does not exist. ` +
        'If a lane moved, update its `directory` in core-lane-graph.ts and the guards that scan it.'
    );
  }
  return resolved;
}
