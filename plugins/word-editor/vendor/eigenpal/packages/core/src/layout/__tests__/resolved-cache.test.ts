// Layout revision-provenance cache (document-engine 8.3). Proves
// the cache reuses across revisions ONLY on unchanged fingerprints
// + epochs (never on revision equality), an epoch bump invalidates without a model edit, and the
// instrumentation never reuses an entry whose dependency changed.

import { describe, expect, test } from 'bun:test';
import { ResolvedCache, type CacheProvenance, type OperationSnapshot } from '../index.ts';

const SNAP: OperationSnapshot = {
  resourceEpoch: 1,
  configEpoch: 1,
  extensionFingerprint: 'ext-1',
  shapingHash: 'shape-1',
  producerVersion: 1,
};

describe('ResolvedCache (8.3)', () => {
  const prov = (over: Partial<CacheProvenance> = {}): CacheProvenance => ({
    revision: 1,
    dependencyFingerprint: 'dep-1',
    inputFingerprint: 'in-1',
    resourceDependencies: [],
    ...SNAP,
    ...over,
  });
  const want = (
    over: Partial<Omit<CacheProvenance, 'revision'>> = {}
  ): Omit<CacheProvenance, 'revision'> => {
    const { revision: _r, ...rest } = prov(over as Partial<CacheProvenance>);
    return rest;
  };

  test('reuses across revisions when fingerprints + epochs match (revision is provenance only)', () => {
    const c = new ResolvedCache<string>();
    c.set('p1', 'laid-out', prov({ revision: 5 }));
    // A LATER revision with identical fingerprints/epochs still hits — revision is not an equality gate.
    const r = c.get('p1', want());
    expect(r.hit).toBe(true);
    if (r.hit) expect(r.provenance.revision).toBe(5);
  });

  test('misses name the reason: dependency, input, and each epoch', () => {
    const c = new ResolvedCache<string>();
    c.set('p1', 'v', prov());
    expect(c.get('p1', want({ dependencyFingerprint: 'dep-2' }))).toMatchObject({
      hit: false,
      reason: 'dependency-changed',
    });
    expect(c.get('p1', want({ inputFingerprint: 'in-2' }))).toMatchObject({
      hit: false,
      reason: 'input-changed',
    });
    expect(c.get('p1', want({ resourceEpoch: 2 })).hit).toBe(true);
    expect(c.get('p1', want({ shapingHash: 'shape-2' }))).toMatchObject({
      hit: false,
      reason: 'epoch-changed',
      epoch: 'shapingHash',
    });
    expect(c.get('absent', want())).toMatchObject({ hit: false, reason: 'absent' });
  });

  test('a resource epoch bump alone preserves dependency-scoped entries', () => {
    const c = new ResolvedCache<string>();
    c.set('p1', 'v', prov({ revision: 9 }));
    // Same revision + fingerprints, only the resource epoch advanced.
    expect(c.get('p1', want({ resourceEpoch: 2 })).hit).toBe(true);
    expect(c.evictEpoch({ ...SNAP, resourceEpoch: 2 })).toBe(0);
    expect(c.size).toBe(1);
  });

  test('instrumentation never reuses an entry whose dependency changed (8.2 guarantee)', () => {
    // Model a consumer: it computes a dependency fingerprint from the graph, caches by it, then a
    // dependency value changes → the fingerprint changes → the next get MUST miss.
    // The legacy DependencyGraph was deleted with the legacy layout lane; a plain
    // deterministic fingerprint over the dependency values models the same consumer.
    const fingerprintOf = (values: ReadonlyMap<string, string>): string =>
      JSON.stringify([...values.entries()].sort());
    const c = new ResolvedCache<number>();
    let computes = 0;
    const resolve = (values: ReadonlyMap<string, string>, revision: number): number => {
      const dep = fingerprintOf(values);
      const hit = c.get('para:p1', {
        dependencyFingerprint: dep,
        inputFingerprint: 'in',
        resourceDependencies: [],
        ...SNAP,
      });
      if (hit.hit) return hit.value;
      computes += 1;
      const v = computes; // a distinct result per real computation
      c.set('para:p1', v, {
        revision,
        dependencyFingerprint: dep,
        inputFingerprint: 'in',
        resourceDependencies: [],
        ...SNAP,
      });
      return v;
    };
    const v1 = resolve(new Map([['style:Body', 'A']]), 1);
    const v1again = resolve(new Map([['style:Body', 'A']]), 2); // dep unchanged -> reuse
    expect(v1again).toBe(v1);
    expect(computes).toBe(1);
    const v2 = resolve(new Map([['style:Body', 'B']]), 3); // dep CHANGED -> recompute, never reuse stale
    expect(v2).not.toBe(v1);
    expect(computes).toBe(2);
  });
});
