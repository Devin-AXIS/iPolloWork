// Adversarial tests for the capability/runtime registry (document-engine 0.1).
// Covers the spec scenarios: id collision without registration order, dependency
// cycle before open, replacement version/authorization/ambiguity, order
// independence, and frozen-id integrity.

import { describe, expect, test } from 'bun:test';
import {
  resolve,
  RegistryError,
  isValidId,
  satisfies,
  parseSemVer,
  compareSemVer,
  ALL_FROZEN_IDS,
  ORIGIN_IDS,
  RUNTIME_PORT_IDS,
  type FeatureBundle,
  type Contribution,
} from '../registry/index.ts';

const cmd = (id: string, extra: Partial<Contribution> = {}): Contribution => ({
  kind: 'command',
  id,
  version: '1.0.0',
  ...extra,
});

const bundle = (id: string, extra: Partial<FeatureBundle> = {}): FeatureBundle => ({
  id,
  version: '1.0.0',
  contributions: [],
  ...extra,
});

describe('id grammar', () => {
  test('accepts reverse-domain and package-owned forms', () => {
    expect(isValidId('dev.docx-editor.core.command.insert-text')).toBe(true);
    expect(isValidId('@docx-editor.dev/engine-core#command/insert-text')).toBe(true);
  });
  test('rejects single-label, empty, and spaced ids', () => {
    expect(isValidId('insertText')).toBe(false);
    expect(isValidId('')).toBe(false);
    expect(isValidId('dev docx')).toBe(false);
  });
});

describe('semver ranges', () => {
  test('caret pins major (or minor/patch at 0)', () => {
    expect(satisfies('1.9.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('0.2.9', '^0.2.0')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false);
  });
  test('exact, wildcard, and bounded pair', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('9.9.9', '*')).toBe(true);
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
  });
  test('malformed range throws (never silently compatible)', () => {
    expect(() => satisfies('1.0.0', 'not-a-range')).toThrow();
  });
  test('compareSemVer orders correctly', () => {
    expect(compareSemVer(parseSemVer('1.0.0'), parseSemVer('1.0.1'))).toBe(-1);
    expect(compareSemVer(parseSemVer('2.0.0'), parseSemVer('1.9.9'))).toBe(1);
  });
});

describe('collision', () => {
  test('two bundles registering one command id fail naming both, order-free', () => {
    const a = bundle('a.pkg', { contributions: [cmd('dev.x.command.same')] });
    const b = bundle('b.pkg', { contributions: [cmd('dev.x.command.same')] });
    const run = (bundles: FeatureBundle[]) => {
      try {
        resolve(bundles);
        return null;
      } catch (e) {
        return e as RegistryError;
      }
    };
    const e1 = run([a, b])!;
    const e2 = run([b, a])!;
    expect(e1).toBeInstanceOf(RegistryError);
    expect(e1.code).toBe('id-collision');
    expect(e1.responsible).toEqual(['a.pkg', 'b.pkg']);
    // Registration order does not change the error identity.
    expect(e2.responsible).toEqual(e1.responsible);
  });
});

describe('dependencies and conflicts', () => {
  test('cycle fails before open, naming the cycle', () => {
    const a = bundle('a.pkg', { dependencies: ['b.pkg'] });
    const b = bundle('b.pkg', { dependencies: ['a.pkg'] });
    try {
      resolve([a, b]);
      throw new Error('expected cycle');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryError);
      expect((e as RegistryError).code).toBe('dependency-cycle');
      expect((e as RegistryError).responsible).toContain('a.pkg');
      expect((e as RegistryError).responsible).toContain('b.pkg');
    }
  });
  test('missing dependency fails', () => {
    expect(() => resolve([bundle('a.pkg', { dependencies: ['missing.pkg'] })])).toThrow(
      RegistryError
    );
  });
  test('declared conflict between enabled bundles fails', () => {
    const a = bundle('a.pkg', { conflicts: ['b.pkg'] });
    const b = bundle('b.pkg');
    try {
      resolve([a, b]);
      throw new Error('expected conflict');
    } catch (e) {
      expect((e as RegistryError).code).toBe('conflict');
    }
  });
  test('valid acyclic graph resolves', () => {
    const base = bundle('base.pkg', { contributions: [cmd('dev.x.command.base')] });
    const feat = bundle('feat.pkg', { dependencies: ['base.pkg'] });
    const reg = resolve([feat, base]);
    expect(reg.get('command', 'dev.x.command.base')).toBeDefined();
    expect(reg.extensions.size).toBe(2);
  });
});

describe('required ports', () => {
  test('missing port fails; provided port passes', () => {
    const b = bundle('a.pkg', { requiredPorts: [RUNTIME_PORT_IDS.shaping] });
    expect(() => resolve([b])).toThrow(RegistryError);
    expect(() => resolve([b], { availablePorts: [RUNTIME_PORT_IDS.shaping] })).not.toThrow();
  });
});

describe('replacement precedence', () => {
  const target = (policy: Contribution['replaceable']) =>
    bundle('base.pkg', {
      contributions: [cmd('dev.x.command.target', { replaceable: policy })],
    });
  const replacer = (ext: string, range: string, priority?: number) =>
    bundle(ext, {
      contributions: [
        cmd(`${ext.replace('.', '-')}.command.impl` as string, {
          id: 'dev.x.command.impl',
          replaces: { targetId: 'dev.x.command.target', targetRange: range, priority },
        }),
      ],
    });

  test('unauthorized replacement (policy none) fails', () => {
    const e = catchErr(() => resolve([target({ kind: 'none' }), replacer('r.pkg', '^1.0.0')]));
    expect(e.code).toBe('unauthorized-replacement');
  });

  test('replacement outside version range fails', () => {
    const e = catchErr(() => resolve([target({ kind: 'single' }), replacer('r.pkg', '^2.0.0')]));
    expect(e.code).toBe('replacement-version-mismatch');
  });

  test('single authorized replacement wins', () => {
    const reg = resolve([target({ kind: 'single' }), replacer('r.pkg', '^1.0.0')]);
    const winner = reg.get('command', 'dev.x.command.target')!;
    expect(winner.replaces?.targetId).toBe('dev.x.command.target');
  });

  test('two replacers under single policy are ambiguous', () => {
    const e = catchErr(() =>
      resolve([
        target({ kind: 'single' }),
        replacer('r1.pkg', '^1.0.0'),
        replacer('r2.pkg', '^1.0.0'),
      ])
    );
    expect(e.code).toBe('ambiguous-replacement');
  });

  test('priority policy picks unique highest, order-free', () => {
    const bundles = [
      target({ kind: 'priority' }),
      replacer('r1.pkg', '^1.0.0', 10),
      replacer('r2.pkg', '^1.0.0', 5),
    ];
    const forward = resolve(bundles).get('command', 'dev.x.command.target')!;
    const reversed = resolve([...bundles].reverse()).get('command', 'dev.x.command.target')!;
    expect(forward.replaces?.priority).toBe(10);
    expect(reversed.replaces?.priority).toBe(10);
  });

  test('priority tie is ambiguous', () => {
    const e = catchErr(() =>
      resolve([
        target({ kind: 'priority' }),
        replacer('r1.pkg', '^1.0.0', 7),
        replacer('r2.pkg', '^1.0.0', 7),
      ])
    );
    expect(e.code).toBe('ambiguous-replacement');
  });

  test('replacing a missing target fails', () => {
    const e = catchErr(() => resolve([replacer('r.pkg', '^1.0.0')]));
    expect(e.code).toBe('replacement-target-missing');
  });
});

describe('frozen ids', () => {
  test('all frozen ids are valid and globally unique', () => {
    for (const id of ALL_FROZEN_IDS) expect(isValidId(id)).toBe(true);
    expect(new Set(ALL_FROZEN_IDS).size).toBe(ALL_FROZEN_IDS.length);
  });
  test('origins and ports are disjoint frozen namespaces', () => {
    const origins = new Set(Object.values(ORIGIN_IDS));
    const ports = new Set(Object.values(RUNTIME_PORT_IDS));
    for (const p of ports) expect(origins.has(p)).toBe(false);
  });
});

function catchErr(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (e) {
    return e as RegistryError;
  }
  throw new Error('expected RegistryError');
}
