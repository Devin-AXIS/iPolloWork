// The lane resolver has to fail loudly (task 10.2).
//
// Every guard in this directory scans a lane by path and calls `collectSources` on the
// result. `collectSources` on a missing directory returns [], so a guard whose lane moved
// passes having examined no files. That is the failure this file exists to prevent: not a
// wrong answer, a green run that proved nothing.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_LANES, laneSourceRoot, type LaneName } from '../../__tests__/core-lane-graph.ts';
import {
  existingLanePath,
  lanePath,
  NESTED_LANE_DIRECTORIES,
  PACKAGES_ROOT,
} from './lane-paths.ts';

describe('lane path resolution', () => {
  test('a path that does not exist THROWS rather than scanning nothing', () => {
    expect(() => existingLanePath('core/src/layout/definitely-not-here')).toThrow(/does not exist/);
  });

  test('the resolver points at real files, so the guards are scanning something', () => {
    const resolved = existingLanePath('core/src/store');
    expect(resolved.startsWith(PACKAGES_ROOT)).toBe(true);
  });

  test('every lane in the DAG resolves to source that exists', () => {
    // The guards name lanes by path literal. If a lane's directory changes and a guard is not
    // updated, this is what fails first — before a guard silently scans an empty list.
    for (const lane of Object.keys(CORE_LANES) as LaneName[]) {
      const root = laneSourceRoot(lane);
      expect({ lane, exists: existsSync(lanePath(root)) }).toEqual({ lane, exists: true });
    }
  });

  test('the nested-lane set names real directories under the contracts lane', () => {
    // A collector walking `core/src` skips these to stay inside one lane. A stale name here
    // means a lane's files get attributed to `contracts`.
    for (const directory of NESTED_LANE_DIRECTORIES) {
      const resolved = lanePath(join('core', 'src', directory));
      expect({ directory, exists: existsSync(resolved) }).toEqual({ directory, exists: true });
    }
  });

  test('fixture paths in this lane still resolve', () => {
    // The failure this catches is SILENT. Several tests here are written as
    // `test.if(existsSync(fixture))`, so a fixture path that stops resolving does not fail —
    // the test quietly stops running. Moving the lane two directories deeper broke four of
    // them that way, and the suite still reported green.
    const fixtures = join(PACKAGES_ROOT, '..', 'e2e', 'fixtures');
    expect({ fixtures, found: existsSync(fixtures) }).toEqual({ fixtures, found: true });

    // And the relative form the tests actually use, from this directory.
    const fromHere = join(import.meta.dir, '..', '..', '..', '..', '..', 'e2e', 'fixtures');
    expect(existsSync(fromHere)).toBe(true);
  });
});
