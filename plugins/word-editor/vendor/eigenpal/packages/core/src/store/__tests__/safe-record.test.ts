// Tests for null-prototype parser intermediates + dangerous-key rejection
// (document-engine task 2.5).

import { describe, expect, test } from 'bun:test';
import {
  toSafeRecord,
  nullRecord,
  isDangerousKey,
  DangerousKeyError,
} from '../package/safe-record.ts';

describe('safe records', () => {
  test('nullRecord has no prototype', () => {
    const r = nullRecord();
    expect(Object.getPrototypeOf(r)).toBe(null);
    expect((r as Record<string, unknown>).toString).toBeUndefined();
  });

  test('converts nested objects to null-prototype records preserving data', () => {
    const safe = toSafeRecord({ a: 1, b: { c: [2, 3], d: 'x' } }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(safe)).toBe(null);
    const b = safe.b as Record<string, unknown>;
    expect(Object.getPrototypeOf(b)).toBe(null);
    expect(b.c).toEqual([2, 3]);
    expect(b.d).toBe('x');
  });

  test('rejects dangerous keys at the root and nested, naming the path', () => {
    expect(isDangerousKey('__proto__')).toBe(true);
    // A real own "__proto__" key only arises via JSON.parse / bracket assignment
    // (an object literal sets the prototype instead), so use JSON.parse here.
    expect(() => toSafeRecord(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow(
      DangerousKeyError
    );
    expect(() => toSafeRecord({ a: { constructor: {} } })).toThrow(/a/);
    expect(() => toSafeRecord({ nested: { prototype: 1 } })).toThrow(DangerousKeyError);
  });

  test('a JSON.parse-style prototype-pollution payload does not pollute Object', () => {
    // Simulate a parsed attribute-name -> key assignment payload.
    const payload = JSON.parse('{"__proto__": {"isAdmin": true}}');
    expect(() => toSafeRecord(payload)).toThrow(DangerousKeyError);
    // Sanity: no global pollution regardless.
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  test('arrays and primitives pass through', () => {
    expect(toSafeRecord([1, 'a', null, { k: 2 }])).toEqual([1, 'a', null, { k: 2 }]);
    expect(toSafeRecord(42)).toBe(42);
    expect(toSafeRecord('x')).toBe('x');
  });

  test('cyclic input is rejected', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => toSafeRecord(a)).toThrow(/cyclic/);
  });
});
