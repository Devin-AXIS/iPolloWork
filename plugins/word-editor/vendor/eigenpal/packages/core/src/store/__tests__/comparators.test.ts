// Tests for the frozen canonical comparator formats (document-engine task 0.4).

import { describe, expect, test } from 'bun:test';
import {
  canonicalize,
  stableHash,
  compareArtifacts,
  fingerprint,
  COMPARATORS,
} from '../comparators/index.ts';

describe('canonicalize', () => {
  test('key order does not affect canonical form; array order does', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
  test('drops declared ephemera at any depth', () => {
    const e = new Set(['revision']);
    expect(canonicalize({ x: 1, revision: 9 }, e)).toBe(canonicalize({ x: 1, revision: 3 }, e));
    expect(canonicalize({ n: { revision: 1, v: 2 } }, e)).toBe(canonicalize({ n: { v: 2 } }, e));
  });
  test('-0 normalizes and non-finite numbers are rejected', () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(NaN)).toThrow();
  });
  test('cyclic structures are rejected', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalize(a)).toThrow();
  });
  test('stableHash is deterministic and key-order independent', () => {
    expect(stableHash({ a: 1, b: [2, 3] })).toBe(stableHash({ b: [2, 3], a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    expect(stableHash({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
  test('stableHash keeps the 64-bit FNV-1a digest of the canonical form', () => {
    // The BigInt definition the digest was frozen with. Persisted and compared hashes must
    // not move when the arithmetic does.
    const reference = (s: string): string => {
      let hash = 0xcbf29ce484222325n;
      for (let i = 0; i < s.length; i++) {
        hash ^= BigInt(s.charCodeAt(i));
        hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
      }
      return hash.toString(16).padStart(16, '0');
    };
    let seed = 7;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    const samples: unknown[] = ['', 'a', '￿', '😀', { a: 1, b: [2, 'x'] }];
    for (let n = 0; n < 200; n++) {
      let text = '';
      const length = random() % 64;
      for (let i = 0; i < length; i++) text += String.fromCharCode(random() % 0x10000);
      samples.push(text, { text, n });
    }
    for (const value of samples) expect(stableHash(value)).toBe(reference(canonicalize(value)));
  });
});

describe('authored-state comparator (canonical-exact, ephemera excluded)', () => {
  test('equal when only ephemera differ', () => {
    const a = { body: 'x', revision: 1, commitId: 'c1', producedAt: 100 };
    const b = { body: 'x', revision: 2, commitId: 'c2', producedAt: 200 };
    expect(compareArtifacts('authoredState', a, b).equal).toBe(true);
    expect(fingerprint('authoredState', a)).toBe(fingerprint('authoredState', b));
  });
  test('unequal when authored content differs, with diagnostic forms', () => {
    const r = compareArtifacts('authoredState', { body: 'x' }, { body: 'y' });
    expect(r.equal).toBe(false);
    expect(r.left).toBeDefined();
    expect(r.right).toBeDefined();
  });
});

describe('exact comparators keep every field', () => {
  test('shaped runs compare all fields (no ephemera drop)', () => {
    const a = { glyphs: [1, 2], advances: [10, 12], revision: 1 };
    const b = { glyphs: [1, 2], advances: [10, 12], revision: 2 };
    // revision is NOT ephemera for exact-mode comparators, so these differ.
    expect(compareArtifacts('shapedRun', a, b).equal).toBe(false);
  });
});

describe('mode guards', () => {
  test('yjs state vector is not an equivalence basis', () => {
    expect(() => compareArtifacts('yjsStateVector', {}, {})).toThrow(/not an equivalence basis/);
    expect(() => fingerprint('yjsStateVector', {})).toThrow();
  });
  test('raster tolerance requires explicit epsilon', () => {
    expect(() => compareArtifacts('rasterCheckpoint', 1, 1)).toThrow(/epsilon/);
    expect(compareArtifacts('rasterCheckpoint', 100, 100.5, { epsilon: 1 }).equal).toBe(true);
    expect(compareArtifacts('rasterCheckpoint', 100, 102, { epsilon: 1 }).equal).toBe(false);
  });
  test('artifacts required to match exactly declare no tolerance', () => {
    for (const name of [
      'shapedRun',
      'paginationFingerprint',
      'semanticTree',
      'hitTest',
      'anchor',
    ] as const) {
      expect(COMPARATORS[name].mode).toBe('exact');
    }
  });
});

describe('canonicalize rejection names the field', () => {
  test('an undefined value reports its key path', () => {
    expect(() => canonicalize({ theme: { faces: [{ ok: 1 }, { face: undefined }] } })).toThrow(
      'unsupported value type in comparator input: undefined at theme.faces.1.face'
    );
    expect(() => canonicalize(undefined)).toThrow(
      'unsupported value type in comparator input: undefined'
    );
  });
});
